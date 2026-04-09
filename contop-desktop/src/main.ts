import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { check } from "@tauri-apps/plugin-updater";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

interface ProviderAuthEntry {
  mode: "api_key" | "cli_proxy";
  proxy_url: string;
}

interface Settings {
  version: number;
  gemini_api_key: string;
  openai_api_key: string;
  anthropic_api_key: string;
  openrouter_api_key: string;
  restricted_paths: string[];
  forbidden_commands: string[];
  keep_host_awake: boolean;
  proxy_auto_start: boolean;
  destructive_patterns: string[];
  provider_auth?: {
    gemini: ProviderAuthEntry;
    anthropic: ProviderAuthEntry;
    openai: ProviderAuthEntry;
  };
}

interface ConnectionInfo {
  lan_ip: string;
  tailscale_ip: string | null;
  tailscale_available: boolean;
  tunnel_url: string | null;
  tunnel_active: boolean;
  connected_clients: number;
  has_active_token: boolean;
  token_expires_at: string | null;
  token_connection_type: string | null;
  active_token: string | null;
  server_port: number;
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let connectionInfoTimer: ReturnType<typeof setInterval> | null = null;
let proxyWatchdogTimer: ReturnType<typeof setInterval> | null = null;
/** Providers the user explicitly stopped - watchdog won't auto-restart these. */
const userStoppedProxies = new Set<"anthropic" | "gemini" | "openai">();
let connectionInfoFetching = false;
let currentBlobUrl: string | null = null;
let currentSettings: Settings | null = null;
let hasApiKey = false;
let currentServerStatus: ServerStatus = "stopped";
let activeApiKey = "";
let startupTimerInterval: ReturnType<typeof setInterval> | null = null;
let startupStartTime = 0;
let previousHasActiveToken: boolean | null = null;
/** Set when forget-connection runs while server is down - cleared after server-side revoke succeeds */
let pendingForgetRevoke = false;
let showingTempQR = false;
let deviceEverConnected = false;
let lastKnownClients = 0;
let minClientsSinceTempQR = 0;
let tempDeviceConnected = false;
let devicesPollingTimer: ReturnType<typeof setInterval> | null = null;
let lastEventTimestamp: string | null = null;
let notificationsReady = false;

interface DeviceInfo {
  device_id: string | null;
  device_name: string | null;
  connection_type: string;
  connected: boolean;
  connection_path: string | null;
  last_location: string | null;
  last_seen: string | null;
  paired_at: string;
  expires_at: string;
}

interface DeviceEvent {
  type: string;
  device_id: string | null;
  device_name: string | null;
  details?: string;
  timestamp: string;
}

interface DeviceListResponse {
  devices: DeviceInfo[];
  events: DeviceEvent[];
}

// --- DOM Accessors ---

const $ = (id: string) => document.getElementById(id)!;
const statusDot = () => $("status-dot");
const statusText = () => $("status-text");
const sidebarDot = () => $("sidebar-status-dot");
const sidebarText = () => $("sidebar-status-text");
const startupTimer = () => $("startup-timer");
const startupDetail = () => $("startup-detail");
const qrImage = () => $("qr-image") as HTMLImageElement;
const qrPlaceholder = () => $("qr-placeholder");
const startBtn = () => $("start-btn") as HTMLButtonElement;
const stopBtn = () => $("stop-btn") as HTMLButtonElement;
const restartBtn = () => $("restart-btn") as HTMLButtonElement;

/** Native-looking confirm dialog that avoids the browser's "localhost says" prefix. */
function appConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-card">
        <p class="confirm-message">${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel">Cancel</button>
          <button class="confirm-btn confirm-ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".confirm-cancel")!.addEventListener("click", () => { overlay.remove(); resolve(false); });
    overlay.querySelector(".confirm-ok")!.addEventListener("click", () => { overlay.remove(); resolve(true); });
  });
}

const STATUS_COLORS: Record<ServerStatus, string> = {
  running: "#22c55e",
  starting: "#f59e0b",
  stopping: "#f59e0b",
  stopped: "#6b7280",
  error: "#ef4444",
};

const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Stopped",
  starting: "Starting",
  stopping: "Stopping...",
  running: "Running",
  error: "Error",
};

// --- Page Navigation ---

const VALID_PAGES = new Set(["home", "setup", "skills", "devices", "settings"]);

function navigateTo(pageId: string) {
  if (!VALID_PAGES.has(pageId)) return;

  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));

  const page = $(`page-${pageId}`);
  if (page) page.classList.add("active");

  const navBtn = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add("active");
}

// --- Status Management ---

function updateStatus(status: ServerStatus, message?: string) {
  currentServerStatus = status;
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];

  statusDot().style.backgroundColor = color;
  statusText().textContent = label;
  sidebarDot().style.backgroundColor = color;

  // Sidebar status text
  if (status === "running") {
    sidebarText().textContent = "Server running";
  } else if (status === "starting") {
    sidebarText().textContent = "Server starting...";
  } else if (status === "error") {
    sidebarText().textContent = "Server error";
  } else {
    sidebarText().textContent = "Server stopped";
  }

  // Pulsing animation for starting state
  if (status === "starting") {
    statusDot().classList.add("pulsing");
    sidebarDot().classList.add("pulsing");
  } else {
    statusDot().classList.remove("pulsing");
    sidebarDot().classList.remove("pulsing");
  }

  // Startup timer visibility
  if (status !== "starting") {
    stopStartupTimer();
  }

  // Startup detail - show contextual messages or error info
  const detail = startupDetail();
  if (status === "starting") {
    detail.style.display = "";
    detail.style.color = "";
    detail.textContent = "Launching Python server with uv... This may take a moment on first run.";
  } else if (status === "error" && message) {
    detail.style.display = "";
    detail.style.color = "var(--red)";
    detail.textContent = message;
  } else {
    detail.style.display = "none";
    detail.style.color = "";
    detail.textContent = "";
  }

  // Re-enable start button on error so user can retry
  if (status === "error") {
    startBtn().disabled = !hasApiKey;
    stopBtn().disabled = true;
  }

  // Restart button: only enabled when server is running
  restartBtn().disabled = status !== "running";

  updateSetupStep1();
}

// --- Startup Timer (progressive, no hard timeout) ---

function startStartupTimer() {
  startupStartTime = Date.now();
  let lastMilestone = 0;
  startupTimer().style.display = "";
  startupTimer().textContent = "0s";

  startupTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startupStartTime) / 1000);
    startupTimer().textContent = `${elapsed}s`;

    // Update detail message at milestones (>= with guard to fire once per tier)
    if (elapsed >= 120 && lastMilestone < 120) {
      lastMilestone = 120;
      startupDetail().textContent = "This is taking a while. Check if uv and Python 3.12 are installed.";
    } else if (elapsed >= 60 && lastMilestone < 60) {
      lastMilestone = 60;
      startupDetail().textContent = "Taking longer than usual. The server is still trying to start.";
    } else if (elapsed >= 30 && lastMilestone < 30) {
      lastMilestone = 30;
      startupDetail().textContent = "Still starting... First-time setup can take a minute or two.";
    } else if (elapsed >= 15 && lastMilestone < 15) {
      lastMilestone = 15;
      startupDetail().textContent = "Installing dependencies... Hang tight.";
    }
  }, 1000);
}

function stopStartupTimer() {
  if (startupTimerInterval !== null) {
    clearInterval(startupTimerInterval);
    startupTimerInterval = null;
  }
  const el = document.getElementById("startup-timer");
  if (el) el.style.display = "none";
}

// --- Health Polling (no hard timeout) ---

function stopPolling() {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function startHealthPolling() {
  const SAFETY_TIMEOUT_MS = 180_000; // 3 minutes - generous fallback
  const pollStart = Date.now();
  let consecutiveErrors = 0;
  let healthCheckRunning = false;

  pollingTimer = setInterval(async () => {
    if (healthCheckRunning) return; // Prevent overlapping async callbacks
    healthCheckRunning = true;
    try {
      const healthy = await invoke<boolean>("check_server_health");
      if (healthy) {
        consecutiveErrors = 0;
        stopPolling();
        updateStatus("running");
        startBtn().disabled = true;
        stopBtn().disabled = false;
        activeApiKey = currentSettings?.gemini_api_key || "";
        showConnectionInfo();
        // If a forget/revoke happened while server was down, tokens.json was
        // already deleted by forget_connection - the server started with 0 tokens.
        // No need for a server-side DELETE (which could race with the new token).
        // Just clear the flag and create a fresh QR.
        const wasForgetPending = pendingForgetRevoke;
        pendingForgetRevoke = false;
        try { await fetchQRCode(true); } catch { /* QR fetch failed - error shown in placeholder */ }
        // Poll faster (1s) after a pending forget - the mobile's "Forget Connection"
        // also sends DELETE /api/pair which may revoke the token we just created.
        // Fast polling detects this and regenerates the QR before the user scans.
        startConnectionInfoPolling(wasForgetPending ? 1000 : 5000);
        startDevicesPolling();
        initNotifications();
        return;
      }
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors++;
    }

    healthCheckRunning = false;

    // Safety fallback: if the process died or something is very wrong
    const elapsed = Date.now() - pollStart;
    if (elapsed > SAFETY_TIMEOUT_MS) {
      stopPolling();
      updateStatus("error", "Server did not respond after 3 minutes. Try stopping and starting again.");
    } else if (consecutiveErrors >= 20 && elapsed > 30_000) {
      // 20 consecutive errors (10s of failures) after at least 30s - process likely crashed
      stopPolling();
      updateStatus("error", "Server process appears to have stopped unexpectedly. Try starting again.");
    }
  }, 500);
}

// --- Connection Info ---

function stopConnectionInfoPolling() {
  if (connectionInfoTimer !== null) {
    clearInterval(connectionInfoTimer);
    connectionInfoTimer = null;
  }
}

async function fetchConnectionInfo() {
  if (connectionInfoFetching) return;
  connectionInfoFetching = true;
  try {
    const info = await invoke<ConnectionInfo>("fetch_connection_info");

    const lanEl = $("info-lan-ip");
    if (lanEl) lanEl.textContent = info.lan_ip;

    const tsEl = $("info-tailscale");
    const tsBadge = $("info-tailscale-badge");
    if (tsEl && tsBadge) {
      if (info.tailscale_available && info.tailscale_ip) {
        tsEl.textContent = info.tailscale_ip;
        tsBadge.textContent = "Active";
        tsBadge.className = "info-badge";
        tsBadge.style.display = "";
      } else {
        tsEl.textContent = "Not installed";
        tsBadge.style.display = "none";
      }
    }

    const tunnelEl = $("info-tunnel");
    const tunnelBadge = $("info-tunnel-badge");
    if (tunnelEl && tunnelBadge) {
      if (info.tunnel_active && info.tunnel_url) {
        const host = info.tunnel_url.replace("https://", "").split("/")[0];
        tunnelEl.textContent = host;
        tunnelBadge.textContent = "Active";
        tunnelBadge.className = "info-badge";
        tunnelBadge.style.display = "";
      } else {
        tunnelEl.textContent = "Not active";
        tunnelBadge.style.display = "none";
      }
    }

    const clientsEl = $("info-clients");
    if (clientsEl) clientsEl.textContent = String(info.connected_clients);

    const hintEl = $("connection-hint");
    if (hintEl) {
      if (info.tailscale_available) {
        hintEl.textContent = "Remote access ready \u2014 clients can connect from anywhere";
        hintEl.className = "hint-green";
      } else if (info.tunnel_active) {
        hintEl.textContent = "Remote access via Cloudflare tunnel (limited reconnection). Install Tailscale for stable remote access.";
        hintEl.className = "hint-amber";
      } else {
        hintEl.textContent = "LAN only \u2014 clients must be on the same Wi-Fi network";
        hintEl.className = "hint-gray";
      }
    }

    // Token expiry note
    const expiryEl = $("token-expiry");
    if (expiryEl) {
      if (info.has_active_token && info.token_expires_at) {
        const expiresAt = new Date(info.token_expires_at);
        const now = new Date();
        const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysRemaining <= 0) {
          expiryEl.textContent = "Token expired \u2014 new QR code generated";
          expiryEl.className = "info-badge expired";
        } else if (daysRemaining <= 3) {
          expiryEl.textContent = `Token expires in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;
          expiryEl.className = "info-badge expiring";
        } else {
          expiryEl.textContent = `Expires ${expiresAt.toLocaleDateString()}`;
          expiryEl.className = "info-badge";
        }
        expiryEl.style.display = "";
      } else {
        expiryEl.style.display = "none";
      }
    }

    // Manual connection details - show toggle when there's an active token
    const manualToggle = $("manual-details-toggle");
    const manualTokenEl = $("manual-token");
    const manualHostEl = $("manual-host");
    const manualPortEl = $("manual-port");
    if (info.has_active_token && info.active_token) {
      manualToggle.style.display = "";
      manualTokenEl.textContent = info.active_token;
      manualHostEl.textContent = info.lan_ip;
      manualPortEl.textContent = String(info.server_port);
    } else {
      manualToggle.style.display = "none";
      $("manual-details").style.display = "none";
    }

    // Track if a device has ever connected during this permanent pairing session.
    // This persists across temporary disconnects (phone sleep, network switch)
    // but resets when the token is revoked (forget).
    const pairedStatusEl = $("paired-status");
    const forgetBtnEl = $("forget-connection-btn");
    const tempQRBtnEl = $("temp-qr-btn");
    const isPermanentlyPaired = info.has_active_token && info.token_connection_type === "permanent";

    if (isPermanentlyPaired && info.connected_clients > 0) {
      deviceEverConnected = true;
    }

    // Track client count for temp QR baseline comparison
    lastKnownClients = info.connected_clients;

    // Temp QR logic: detect when a temp device actually connects by tracking
    // the minimum client count seen since the QR was shown. When the same phone
    // switches from permanent→temp, the count dips (phone disconnects) then
    // rises (phone reconnects via temp QR). Detecting the rise above the minimum
    // handles both same-device switching and new-device connections.
    if (showingTempQR) {
      if (!tempDeviceConnected) {
        // Track the lowest client count seen - catches phone disconnecting from permanent
        minClientsSinceTempQR = Math.min(minClientsSinceTempQR, info.connected_clients);

        if (info.connected_clients > minClientsSinceTempQR) {
          // Client count rose above the minimum → a temp device connected
          tempDeviceConnected = true;
          qrImage().style.display = "none";
          qrPlaceholder().style.display = "none";
          const notice = $("qr-notice");
          notice.textContent = "Temp device connected.";
          notice.style.display = "block";
          if (tempQRBtnEl) {
            tempQRBtnEl.textContent = "Show QR";
            (tempQRBtnEl as HTMLButtonElement).disabled = false;
            tempQRBtnEl.style.display = "";
          }
          const cancelBtnEl = $("cancel-temp-qr-btn");
          if (cancelBtnEl) cancelBtnEl.style.display = "none";
          if (forgetBtnEl) forgetBtnEl.style.display = "";
          if (pairedStatusEl) pairedStatusEl.style.display = "none";
          // Revert to normal polling speed
          startConnectionInfoPolling();
        }
      } else if (info.connected_clients === 0) {
        // All devices disconnected - reset temp QR state so permanent UI takes over
        showingTempQR = false;
        tempDeviceConnected = false;
        if (tempQRBtnEl) {
          tempQRBtnEl.textContent = "Generate Temp QR";
          (tempQRBtnEl as HTMLButtonElement).disabled = false;
        }
        const cancelBtnEl2 = $("cancel-temp-qr-btn");
        if (cancelBtnEl2) cancelBtnEl2.style.display = "none";
        startConnectionInfoPolling();
      }
      // else: QR still showing (no temp device yet) or temp device still connected - no action
    }

    if (!showingTempQR && pairedStatusEl) {
      const cancelBtnEl3 = $("cancel-temp-qr-btn");
      if (cancelBtnEl3) cancelBtnEl3.style.display = "none";
      if (isPermanentlyPaired && deviceEverConnected) {
        // Device has connected at least once: hide QR, show paired status
        pairedStatusEl.style.display = "";
        qrImage().style.display = "none";
        qrPlaceholder().style.display = "none";
        $("qr-notice").style.display = "none";
        if (forgetBtnEl) forgetBtnEl.style.display = "";
        if (tempQRBtnEl) tempQRBtnEl.style.display = "";
      } else {
        // No device connected yet: keep QR visible, hide paired controls
        pairedStatusEl.style.display = "none";
        if (forgetBtnEl) forgetBtnEl.style.display = "none";
        // Always show temp QR button - users can generate temp access even before permanent pairing
        if (tempQRBtnEl) tempQRBtnEl.style.display = "";
      }
    }

    // Cross-device sync: detect token revocation and auto-regenerate QR
    if (previousHasActiveToken === true && !info.has_active_token) {
      // Token was just revoked (e.g., mobile forgot connection) - regenerate QR
      showingTempQR = false;
      deviceEverConnected = false;
      tempDeviceConnected = false;
      minClientsSinceTempQR = 0;
      try {
        await fetchQRCode(true);
        const notice = $("qr-notice");
        notice.textContent = "Connection was forgotten \u2014 scan the new QR code to pair.";
        notice.style.display = "block";
      } catch { /* server may be restarting - fetchQRCode already shows the error */ }
    }
    previousHasActiveToken = info.has_active_token;
  } catch {
    // Server may not be ready yet
  } finally {
    connectionInfoFetching = false;
  }
}

// --- Devices Tab ---

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return "-"; }
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "-"; }
}

function connectionPathLabel(path: string | null): string {
  if (!path) return "-";
  const map: Record<string, string> = { lan: "LAN", tailscale: "Tailscale", tunnel: "Tunnel" };
  return map[path] || path;
}

/** Shared cleanup after forgetting the connection - resets pairing state, QR area, and device list. */
async function performForgetCleanup() {
  try { await invoke("forget_connection"); } catch { /* best-effort */ }

  // Reset state tracking
  previousHasActiveToken = false;
  showingTempQR = false;
  deviceEverConnected = false;
  tempDeviceConnected = false;
  minClientsSinceTempQR = 0;

  // Reset QR area
  const pairedEl = $("paired-status");
  if (pairedEl) pairedEl.style.display = "none";
  $("forget-connection-btn").style.display = "none";
  $("temp-qr-btn").style.display = "none";
  $("cancel-temp-qr-btn").style.display = "none";
  const expiryEl = $("token-expiry");
  if (expiryEl) expiryEl.style.display = "none";

  // Clear device list
  renderDeviceList([]);

  // Generate fresh QR - if server is down, mark as pending so we revoke + regenerate on next start
  try {
    await fetchQRCode(true);
    await pollDevices();
    const notice = $("qr-notice");
    notice.textContent = "Connection forgotten \u2014 scan the new QR code to pair.";
    notice.style.display = "block";
  } catch {
    pendingForgetRevoke = true;
    const notice = $("qr-notice");
    notice.textContent = "Connection forgotten locally. New QR will appear when the server starts.";
    notice.style.display = "block";
    qrImage().style.display = "none";
    qrPlaceholder().textContent = "Server offline \u2014 QR will regenerate on start.";
    qrPlaceholder().style.display = "block";
  }
}

function renderDeviceList(devices: DeviceInfo[]) {
  const listEl = $("devices-list");
  const emptyEl = $("devices-empty");

  if (devices.length === 0) {
    listEl.innerHTML = "";
    emptyEl.style.display = "";
    return;
  }

  emptyEl.style.display = "none";
  listEl.innerHTML = devices.map(d => {
    const statusClass = d.connected ? "connected" : "disconnected";
    const statusLabel = d.connected ? "Connected" : "Disconnected";
    const safeName = escapeHtml(d.device_name || "Unknown Device");
    const safeLocation = escapeHtml(d.last_location || "-");
    const safeDeviceId = escapeHtml(d.device_id || "");
    return `
      <div class="device-card">
        <div class="device-card-header">
          <div class="device-name">
            <span class="device-status-dot ${statusClass}"></span>
            ${safeName}
          </div>
          <span class="device-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="device-meta">
          <div class="device-meta-item">
            <span class="label">Connection</span>
            <span class="value"><span class="connection-path-badge">${connectionPathLabel(d.connection_path)}</span></span>
          </div>
          <div class="device-meta-item">
            <span class="label">Location</span>
            <span class="value">${safeLocation}</span>
          </div>
          <div class="device-meta-item">
            <span class="label">Paired</span>
            <span class="value">${formatDate(d.paired_at)}</span>
          </div>
          <div class="device-meta-item">
            <span class="label">Last seen</span>
            <span class="value">${formatTime(d.last_seen)}</span>
          </div>
        </div>
        <div class="device-actions">
          <button class="btn-revoke" data-device-id="${safeDeviceId}">Revoke</button>
        </div>
      </div>`;
  }).join("");

  // Attach revoke handlers
  listEl.querySelectorAll(".btn-revoke").forEach(btn => {
    btn.addEventListener("click", async () => {
      const deviceId = (btn as HTMLElement).dataset.deviceId;
      try {
        const path = deviceId
          ? `/api/pair?device_id=${encodeURIComponent(deviceId)}`
          : "/api/pair";
        await invoke("proxy_delete", { path });
        await pollDevices();
      } catch (e) {
        // Only offer forget fallback for connection errors (server offline), not server-side HTTP errors
        if (!String(e).includes("Connection Failed")) return;
        if (await appConfirm("Server is offline. Forget the entire connection instead?\nThis will revoke all devices when the server next starts.")) {
          await performForgetCleanup();
        }
      }
    });
  });
}

function processDeviceEvents(events: DeviceEvent[]) {
  if (!events.length) return;

  // Update last event timestamp
  const latest = events[events.length - 1];
  lastEventTimestamp = latest.timestamp;

  if (!notificationsReady) return;

  for (const event of events) {
    const name = event.device_name || "Unknown Device";
    if (event.type === "connected") {
      sendNotification({ title: "Device Connected", body: `${name} connected` });
    } else if (event.type === "token_replaced") {
      sendNotification({ title: "Device Replaced", body: `A new pairing replaced ${name}'s access` });
    } else if (event.type === "revoked") {
      sendNotification({ title: "Device Revoked", body: `${name}'s access was revoked` });
    }
  }
}

async function pollDevices() {
  try {
    const sinceParam = lastEventTimestamp ? `?since=${encodeURIComponent(lastEventTimestamp)}` : "";
    const data = await invoke<DeviceListResponse>("proxy_get", { path: `/api/devices${sinceParam}` });
    renderDeviceList(data.devices);
    processDeviceEvents(data.events);
  } catch (e) {
    console.debug("Device poll failed:", e);
  }
}

function startDevicesPolling() {
  stopDevicesPolling();
  pollDevices();
  devicesPollingTimer = setInterval(pollDevices, 5000);
}

function stopDevicesPolling() {
  if (devicesPollingTimer !== null) {
    clearInterval(devicesPollingTimer);
    devicesPollingTimer = null;
  }
}

async function initNotifications() {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    notificationsReady = granted;
  } catch {
    notificationsReady = false;
  }
}

function startConnectionInfoPolling(intervalMs = 5000) {
  stopConnectionInfoPolling();
  fetchConnectionInfo();
  connectionInfoTimer = setInterval(fetchConnectionInfo, intervalMs);
}

function showConnectionInfo() {
  $("connection-info").style.display = "";
}

function hideConnectionInfo() {
  $("connection-info").style.display = "none";
}

// --- Setup step status ---

function updateSetupStep1() {
  const statusEl = $("setup-server-status");
  if (!statusEl) return;
  if (currentServerStatus === "running") {
    statusEl.textContent = "Running";
    statusEl.className = "setup-card-status running";
  } else {
    statusEl.textContent = "";
    statusEl.className = "setup-card-status";
  }
}

// --- QR Code ---

async function fetchQRCode(_force = false, connectionType?: string) {
  try {
    // Omit connection_type param entirely when not specified - Tauri Option<String>
    // requires the key to be absent (not null) to deserialize as None
    const args: Record<string, string> = {};
    if (connectionType) {
      args.connection_type = connectionType;
    }
    const bytes = await invoke<number[]>("fetch_qr_code", args);
    const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
    }
    currentBlobUrl = URL.createObjectURL(blob);
    qrImage().src = currentBlobUrl;
    qrImage().style.display = "block";
    qrPlaceholder().style.display = "none";
  } catch (e) {
    qrPlaceholder().textContent = `Failed to load QR code: ${e}`;
    qrPlaceholder().style.display = "block";
    throw e;
  }
}

// --- Server Lifecycle ---

// ─── Proxy lifecycle ──────────────────────────────────────────────────────────

/** Extract port number from a proxy URL like "http://localhost:3457". */
function portFromUrl(url: string, fallback: number): number {
  try { return parseInt(new URL(url).port, 10) || fallback; } catch { return fallback; }
}

/** Update the dot indicator and Start/Stop button states for one provider. */
function updateProxyStatusUI(provider: string, status: "running" | "stopped" | "degraded" | "starting"): void {
  const dot = document.getElementById(`proxy-dot-${provider}`);
  if (dot) {
    dot.className = `proxy-dot ${status}`;
    const titles: Record<string, string> = {
      running: "Running", stopped: "Stopped",
      degraded: "Process alive but CLI session failed", starting: "Starting…",
    };
    dot.title = titles[status] || status;
  }
  const startBtn = document.getElementById(`sub-start-${provider}`) as HTMLButtonElement | null;
  const stopBtn = document.getElementById(`sub-stop-${provider}`) as HTMLButtonElement | null;
  const processAlive = status !== "stopped";
  if (startBtn) startBtn.disabled = processAlive;
  if (stopBtn) stopBtn.disabled = !processAlive;
}

/** Notify the server of proxy changes so it pushes live status to mobile. */
async function notifyProxyChange(): Promise<void> {
  try {
    await invoke("proxy_post", { path: "/api/notify-proxy-change", body: {} });
  } catch { /* server may be stopping */ }
}

/** Poll proxy_status for every provider in parallel and refresh the UI dots. */
async function refreshAllProxyStatuses(): Promise<void> {
  await Promise.all(
    (["anthropic", "gemini", "openai"] as const).map(async (provider) => {
      try {
        const result = await invoke<{ status: string }>("proxy_status", { provider });
        const s = result.status as "running" | "stopped" | "degraded" | "starting";
        updateProxyStatusUI(provider, s);
      } catch {
        updateProxyStatusUI(provider, "stopped");
      }
    }),
  );
}

/** Start proxies for cli_proxy providers, stop proxies for api_key providers. */
async function syncProxies(settings: Settings): Promise<void> {
  const providerAuth = settings.provider_auth;
  if (!providerAuth) return;
  for (const provider of ["anthropic", "gemini", "openai"] as const) {
    const cfg = providerAuth[provider];
    if (cfg?.mode === "cli_proxy") {
      // Mode changed to cli_proxy - clear any prior user-stop intent and start
      userStoppedProxies.delete(provider);
      const port = cfg.proxy_url ? portFromUrl(cfg.proxy_url, 0) || undefined : undefined;
      try { await invoke("start_proxy", { provider, port }); } catch { /* already running or npx not found */ }
    } else {
      try { await invoke("stop_proxy", { provider }); } catch { /* not running */ }
    }
  }
  void refreshAllProxyStatuses();
  // Re-check health after proxies have had time to bind their ports (fast + slow)
  setTimeout(() => { void refreshAllProxyStatuses(); void notifyProxyChange(); }, 2000);
  setTimeout(() => void refreshAllProxyStatuses(), 5000);
}

/** Poll proxy status every 30 s and restart any that should be running but have exited. */
let watchdogRunning = false;
function startProxyWatchdog(): void {
  if (proxyWatchdogTimer) return;
  proxyWatchdogTimer = setInterval(async () => {
    if (watchdogRunning || !currentSettings?.provider_auth) return;
    watchdogRunning = true;
    try {
      for (const provider of ["anthropic", "gemini", "openai"] as const) {
        try {
          const result = await invoke<{ status: string }>("proxy_status", { provider });
          const s = result.status as "running" | "stopped" | "degraded" | "starting";
          updateProxyStatusUI(provider, s);
          const shouldManage = !userStoppedProxies.has(provider) && currentSettings.proxy_auto_start !== false && currentSettings.provider_auth[provider]?.mode === "cli_proxy";
          if (!shouldManage) continue;
          if (s === "degraded") {
            // Kill broken proxy so next cycle restarts it cleanly
            try { await invoke("stop_proxy", { provider }); } catch { /* already dead */ }
            updateProxyStatusUI(provider, "stopped");
          } else if (s === "stopped") {
            const cfg = currentSettings.provider_auth[provider];
            const port = cfg?.proxy_url ? portFromUrl(cfg.proxy_url, 0) || undefined : undefined;
            await invoke("start_proxy", { provider, port });
            updateProxyStatusUI(provider, "starting");
            setTimeout(() => void refreshAllProxyStatuses(), 2000);
          }
        } catch { /* ignore - server may be stopping */ }
      }
    } finally {
      watchdogRunning = false;
    }
  }, 30_000);
}

function stopProxyWatchdog(): void {
  if (proxyWatchdogTimer) {
    clearInterval(proxyWatchdogTimer);
    proxyWatchdogTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  // Reset QR area
  qrImage().style.display = "none";
  qrPlaceholder().textContent = "Waiting for server...";
  qrPlaceholder().style.display = "block";
  $("qr-notice").style.display = "none";

  try {
    await invoke("start_server");
  } catch (e) {
    const errMsg = String(e).toLowerCase();
    if (errMsg.includes("already running") || errMsg.includes("already in use")) {
      // Server/port is occupied - kill the process on the port, wait 5s, then retry
      updateStatus("starting", "Port occupied. Killing existing process and restarting...");
      startBtn().disabled = true;
      stopBtn().disabled = true;
      const detail = startupDetail();
      detail.style.display = "";
      detail.style.color = "var(--amber)";
      detail.textContent = "Killing process on port and restarting in 5 seconds...";
      try { await invoke("stop_server"); } catch { /* ignore */ }
      try { await invoke("kill_port_process"); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 5000));
      detail.style.color = "";
      try {
        await invoke("start_server");
      } catch (retryErr) {
        updateStatus("error", String(retryErr));
        return;
      }
    } else {
      updateStatus("error", String(e));
      return;
    }
  }

  updateStatus("starting");
  startBtn().disabled = true;
  stopBtn().disabled = false; // Allow user to abort startup
  startStartupTimer();
  startHealthPolling();
  // Start proxies based on auto-start setting
  if (currentSettings) {
    if (currentSettings.proxy_auto_start !== false) {
      void syncProxies(currentSettings);
    }
    startProxyWatchdog();
  }
}

async function stopServer() {
  updateStatus("stopping");
  startBtn().disabled = true;
  stopBtn().disabled = true;
  stopPolling();
  stopStartupTimer();
  stopConnectionInfoPolling();
  stopDevicesPolling();
  stopProxyWatchdog();
  userStoppedProxies.clear();
  // Kill all CLI proxy processes - they serve no purpose without the server
  for (const provider of ["anthropic", "gemini", "openai"] as const) {
    try { await invoke("stop_proxy", { provider }); } catch { /* already stopped */ }
    updateProxyStatusUI(provider, "stopped");
  }
  await notifyProxyChange();
  hideConnectionInfo();
  // Mark all displayed devices as disconnected (server is off, we can't know real status)
  document.querySelectorAll("#devices-list .device-status-dot").forEach(dot => {
    dot.className = "device-status-dot disconnected";
  });
  document.querySelectorAll("#devices-list .device-status-badge").forEach(badge => {
    badge.className = "device-status-badge disconnected";
    badge.textContent = "Disconnected";
  });
  try {
    await invoke("stop_server");
  } catch {
    // Already stopped
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  qrImage().src = "";
  qrImage().style.display = "none";
  qrPlaceholder().textContent = "Start the server to generate a pairing QR code";
  qrPlaceholder().style.display = "block";
  $("qr-notice").style.display = "none";
  updateStatus("stopped");
  stopBtn().disabled = true;
  startBtn().disabled = !hasApiKey;
}

async function restartServer() {
  restartBtn().disabled = true;
  await stopServer();
  try {
    await startServer();
  } catch {
    // startServer handles its own error state via updateStatus("error"),
    // but ensure buttons are recoverable
    startBtn().disabled = !hasApiKey;
  }
}

// --- API Key ---

function updateApiKeyPrompt(apiKey: string) {
  // Allow server start if any API key is set or any subscription provider is active
  const hasKey = !!apiKey;
  const hasAnySubscription = currentSettings?.provider_auth &&
    (["gemini", "anthropic", "openai"] as const).some(
      (p) => currentSettings!.provider_auth?.[p]?.mode === "cli_proxy"
    );
  hasApiKey = hasKey || !!hasAnySubscription;
  const prompt = $("api-key-prompt");
  prompt.style.display = hasApiKey ? "none" : "";
  startBtn().disabled = !hasApiKey;
}

async function savePromptApiKey() {
  const input = $("prompt-key-input") as HTMLInputElement;
  const key = input.value.trim();
  if (!key) return;

  try {
    const settings = await invoke<Settings>("load_settings");
    settings.gemini_api_key = key;
    await invoke("save_settings", { settings });
    currentSettings = settings;
    await onApiKeyChanged(key);
    input.value = "";
  } catch (e) {
    const text = $("api-key-prompt-text");
    text.textContent = `Failed to save key: ${e}`;
  }
}

async function onApiKeyChanged(newKey: string) {
  updateApiKeyPrompt(newKey);
  if (currentServerStatus === "running" && newKey !== activeApiKey) {
    activeApiKey = newKey;
    try {
      await fetchQRCode();
      const notice = $("qr-notice");
      notice.textContent = "API key changed \u2014 QR code refreshed. Please re-scan.";
      notice.style.display = "block";
    } catch { /* QR refresh failed - fetchQRCode already shows the error */ }
  }
}

// --- Settings ---

function showSettingsStatus(message: string, isError = false) {
  const el = $("settings-status");
  el.textContent = message;
  el.className = isError ? "error" : "";
  if (message) {
    setTimeout(() => {
      el.textContent = "";
      el.className = "";
    }, 3000);
  }
}


function renderSettings(settings: Settings) {
  const keyInput = $("gemini-key-input") as HTMLInputElement;
  keyInput.value = settings.gemini_api_key || "";
  keyInput.placeholder = "Enter your Gemini API key";

  const openrouterInput = $("openrouter-key-input") as HTMLInputElement;
  openrouterInput.value = settings.openrouter_api_key || "";
  openrouterInput.placeholder = "Enter your OpenRouter API key";

  const openaiInput = $("openai-key-input") as HTMLInputElement;
  openaiInput.value = settings.openai_api_key || "";
  openaiInput.placeholder = "Enter your OpenAI API key";

  const anthropicInput = $("anthropic-key-input") as HTMLInputElement;
  anthropicInput.value = settings.anthropic_api_key || "";
  anthropicInput.placeholder = "Enter your Anthropic API key";

  renderList(
    "restricted-paths-list",
    settings.restricted_paths,
    (index, newValue) => editItem("restricted_paths", index, newValue),
    (index) => removeItem("restricted_paths", index)
  );
  renderList(
    "forbidden-commands-list",
    settings.forbidden_commands,
    (index, newValue) => editItem("forbidden_commands", index, newValue),
    (index) => removeItem("forbidden_commands", index)
  );

  // Render subscription proxy port inputs
  for (const provider of ["anthropic", "gemini", "openai"] as const) {
    const cfg = settings.provider_auth?.[provider];
    const proxyUrl = cfg?.proxy_url || "";
    const portInput = $(`sub-port-${provider}`) as HTMLInputElement;
    if (proxyUrl) {
      portInput.value = String(portFromUrl(proxyUrl, parseInt(portInput.value, 10)));
    }
  }

  // Proxy auto-start toggle
  const autoStartBtn = $("proxy-autostart-toggle") as HTMLButtonElement;
  const autoStart = settings.proxy_auto_start !== false; // default true
  autoStartBtn.dataset.on = String(autoStart);
  autoStartBtn.textContent = autoStart ? "On" : "Off";

  // Poll actual proxy process status so dots/buttons reflect reality on page load
  void refreshAllProxyStatuses();
}

function renderList(
  listId: string,
  items: string[],
  onEdit: (index: number, newValue: string) => void,
  onRemove: (index: number) => void
) {
  const ul = $(listId);
  ul.innerHTML = "";
  items.forEach((item, index) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = item;

    const btnGroup = document.createElement("div");
    btnGroup.className = "item-actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.value = item;
      input.className = "inline-edit";
      li.replaceChild(input, span);
      input.focus();

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", () => {
        const newVal = input.value.trim();
        if (newVal && newVal !== item) {
          onEdit(index, newVal);
        } else {
          renderSettings(currentSettings!);
        }
      });
      btnGroup.replaceChild(saveBtn, editBtn);

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveBtn.click();
        if (e.key === "Escape") renderSettings(currentSettings!);
      });
    });

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => onRemove(index));

    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(removeBtn);
    li.appendChild(span);
    li.appendChild(btnGroup);
    ul.appendChild(li);
  });
}

function addRestrictedPath() {
  const input = $("new-path-input") as HTMLInputElement;
  const value = input.value.trim();
  if (!value || !currentSettings) return;
  if (currentSettings.restricted_paths.includes(value)) {
    showSettingsStatus("Path already exists", true);
    return;
  }
  currentSettings.restricted_paths.push(value);
  input.value = "";
  renderSettings(currentSettings);
}

function addForbiddenCommand() {
  const input = $("new-command-input") as HTMLInputElement;
  const value = input.value.trim();
  if (!value || !currentSettings) return;
  if (currentSettings.forbidden_commands.includes(value)) {
    showSettingsStatus("Command already exists", true);
    return;
  }
  currentSettings.forbidden_commands.push(value);
  input.value = "";
  renderSettings(currentSettings);
}

function editItem(listKey: "restricted_paths" | "forbidden_commands", index: number, newValue: string) {
  if (!currentSettings) return;
  if (currentSettings[listKey].includes(newValue)) {
    showSettingsStatus("Duplicate entry", true);
    renderSettings(currentSettings);
    return;
  }
  currentSettings[listKey][index] = newValue;
  renderSettings(currentSettings);
}

function removeItem(listKey: "restricted_paths" | "forbidden_commands", index: number) {
  if (!currentSettings) return;
  currentSettings[listKey].splice(index, 1);
  renderSettings(currentSettings);
}

function resolveKeyInput(inputId: string): string {
  const input = $(inputId) as HTMLInputElement;
  return input.value.trim();
}

async function saveSettings() {
  if (!currentSettings) return;
  currentSettings.gemini_api_key = resolveKeyInput("gemini-key-input");
  currentSettings.openrouter_api_key = resolveKeyInput("openrouter-key-input");
  currentSettings.openai_api_key = resolveKeyInput("openai-key-input");
  currentSettings.anthropic_api_key = resolveKeyInput("anthropic-key-input");

  // Proxy auto-start
  const autoStartBtn = $("proxy-autostart-toggle") as HTMLButtonElement;
  currentSettings.proxy_auto_start = autoStartBtn.dataset.on === "true";

  // Collect subscription proxy port settings (mode is set by Start/Stop buttons)
  if (!currentSettings.provider_auth) {
    currentSettings.provider_auth = {
      anthropic: { mode: "api_key", proxy_url: "" },
      gemini: { mode: "api_key", proxy_url: "" },
      openai: { mode: "api_key", proxy_url: "" },
    };
  }
  for (const provider of ["anthropic", "gemini", "openai"] as const) {
    const portInput = $(`sub-port-${provider}`) as HTMLInputElement;
    const port = parseInt(portInput.value, 10);
    const proxyUrl = port ? `http://localhost:${port}` : currentSettings.provider_auth[provider]?.proxy_url || "";
    // Preserve existing mode - it's set by Start/Stop actions, not a checkbox
    const existingMode = currentSettings.provider_auth[provider]?.mode ?? "api_key";
    currentSettings.provider_auth[provider] = { mode: existingMode, proxy_url: proxyUrl };
  }
  try {
    await invoke("save_settings", { settings: currentSettings });
    const refreshed = await invoke<Settings>("load_settings");
    currentSettings = refreshed;
    renderSettings(refreshed);
    showSettingsStatus("Settings saved");
    await onApiKeyChanged(refreshed.gemini_api_key);
    // Sync proxy processes to reflect new subscription auth settings
    void syncProxies(refreshed);
  } catch (e) {
    showSettingsStatus(`Failed to save: ${e}`, true);
  }
}

async function restoreDefaults() {
  try {
    const defaults = await invoke<Settings>("reset_settings");
    currentSettings = defaults;
    renderSettings(defaults);
    showSettingsStatus("Defaults restored");
  } catch (e) {
    showSettingsStatus(`Failed to restore defaults: ${e}`, true);
  }
}

// --- Away Mode UI ---

function showAwayStatus(elementId: string, message: string, isError = false) {
  const el = $(elementId);
  el.textContent = message;
  el.className = isError ? "away-status error" : "away-status";
  if (message) setTimeout(() => { el.textContent = ""; el.className = "away-status"; }, 3000);
}

async function loadAwayModeUI() {
  try {
    const cfg = await invoke<{ enabled: boolean; has_pin: boolean; auto_engage_minutes: number; idle_timeout_enabled: boolean }>("get_away_mode_config");

    // Enable toggle
    const enableBtn = $("away-enabled-toggle") as HTMLButtonElement;
    enableBtn.dataset.on = String(cfg.enabled);
    enableBtn.textContent = cfg.enabled ? "On" : "Off";

    // Idle toggle
    const idleBtn = $("away-idle-toggle") as HTMLButtonElement;
    idleBtn.dataset.on = String(cfg.idle_timeout_enabled);
    idleBtn.textContent = cfg.idle_timeout_enabled ? "On" : "Off";

    // Idle minutes
    const idleRow = $("away-idle-minutes-row");
    idleRow.style.display = cfg.idle_timeout_enabled ? "flex" : "none";
    ($("away-idle-minutes") as HTMLInputElement).value = String(cfg.auto_engage_minutes);

    // Engage button enabled only if PIN is set
    ($("engage-away-btn") as HTMLButtonElement).disabled = !cfg.has_pin;
  } catch (e) {
    console.error("Failed to load away mode config:", e);
  }
}

function initAwayModeControls() {
  // Enable toggle
  $("away-enabled-toggle").addEventListener("click", async () => {
    const btn = $("away-enabled-toggle") as HTMLButtonElement;
    const newVal = btn.dataset.on !== "true";
    try {
      await invoke("update_away_mode_settings", { enabled: newVal });
      btn.dataset.on = String(newVal);
      btn.textContent = newVal ? "On" : "Off";
    } catch (e) {
      showAwayStatus("away-pin-status", `${e}`, true);
    }
  });

  // Set PIN
  $("set-away-pin-btn").addEventListener("click", async () => {
    const pin = ($("away-pin-input") as HTMLInputElement).value;
    const confirm = ($("away-pin-confirm") as HTMLInputElement).value;
    if (pin !== confirm) {
      showAwayStatus("away-pin-status", "PINs do not match", true);
      return;
    }
    try {
      await invoke("set_away_pin", { pin });
      showAwayStatus("away-pin-status", "PIN set successfully");
      ($("away-pin-input") as HTMLInputElement).value = "";
      ($("away-pin-confirm") as HTMLInputElement).value = "";
      ($("engage-away-btn") as HTMLButtonElement).disabled = false;
    } catch (e) {
      showAwayStatus("away-pin-status", `${e}`, true);
    }
  });

  // Set emergency PIN
  $("set-emergency-pin-btn").addEventListener("click", async () => {
    const pin = ($("emergency-pin-input") as HTMLInputElement).value;
    const confirm = ($("emergency-pin-confirm") as HTMLInputElement).value;
    if (pin !== confirm) {
      showAwayStatus("emergency-pin-status", "PINs do not match", true);
      return;
    }
    try {
      await invoke("set_emergency_pin", { pin });
      showAwayStatus("emergency-pin-status", "Emergency PIN set");
      ($("emergency-pin-input") as HTMLInputElement).value = "";
      ($("emergency-pin-confirm") as HTMLInputElement).value = "";
    } catch (e) {
      showAwayStatus("emergency-pin-status", `${e}`, true);
    }
  });

  // Idle toggle
  $("away-idle-toggle").addEventListener("click", async () => {
    const btn = $("away-idle-toggle") as HTMLButtonElement;
    const newVal = btn.dataset.on !== "true";
    try {
      await invoke("update_away_mode_settings", { idle_timeout_enabled: newVal });
      btn.dataset.on = String(newVal);
      btn.textContent = newVal ? "On" : "Off";
      $("away-idle-minutes-row").style.display = newVal ? "flex" : "none";
    } catch (e) {
      showAwayStatus("away-pin-status", `${e}`, true);
    }
  });

  // Stepper buttons for idle minutes
  function getIdleMinutes(): number {
    return parseInt(($("away-idle-minutes") as HTMLInputElement).value || "5", 10);
  }
  function setIdleMinutes(val: number) {
    ($("away-idle-minutes") as HTMLInputElement).value = String(Math.max(1, Math.min(120, val)));
  }
  $("idle-minutes-dec").addEventListener("click", () => setIdleMinutes(getIdleMinutes() - 1));
  $("idle-minutes-inc").addEventListener("click", () => setIdleMinutes(getIdleMinutes() + 1));

  // Save idle minutes
  $("save-idle-minutes-btn").addEventListener("click", async () => {
    const val = getIdleMinutes();
    if (isNaN(val) || val < 1) return;
    try {
      await invoke("update_away_mode_settings", { auto_engage_minutes: val });
      showAwayStatus("away-pin-status", "Idle timeout saved");
    } catch (e) {
      showAwayStatus("away-pin-status", `${e}`, true);
    }
  });

  // Engage button (disengage happens via the overlay PIN pad)
  $("engage-away-btn").addEventListener("click", async () => {
    try {
      await invoke("engage_away_mode");
    } catch (e) {
      showAwayStatus("away-pin-status", `${e}`, true);
    }
  });
}

// --- Skills Page ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface SkillInfo {
  name: string;
  description: string;
  version: string;
  skill_type: string;
  enabled: boolean;
  has_scripts: boolean;
}

interface WorkflowInfo {
  name: string;
  filename: string;
  content: string;
}

async function loadSkills() {
  const listEl = $("skills-list");
  const emptyEl = $("skills-empty");
  if (!listEl || !emptyEl) return;

  try {
    const skills = await invoke<SkillInfo[]>("proxy_get", { path: "/api/skills" });
    if (!skills || skills.length === 0) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    const badgeClass: Record<string, string> = {
      prompt: "badge-prompt",
      workflow: "badge-workflow",
      python: "badge-python",
      mixed: "badge-mixed",
    };

    listEl.innerHTML = skills
      .map(
        (s) => `
      <div class="skill-card">
        <div class="skill-info">
          <div class="skill-header">
            <span class="skill-name">${escapeHtml(s.name)}</span>
            <span class="skill-type-badge ${badgeClass[s.skill_type] || ""}">${escapeHtml(s.skill_type)}</span>
          </div>
          <div class="skill-description">${escapeHtml(s.description)}</div>
        </div>
        <div class="skill-actions">
          <button class="btn-sm skill-view-btn" data-skill="${escapeHtml(s.name)}">View</button>
          <label class="skill-toggle">
            <input type="checkbox" data-skill="${escapeHtml(s.name)}" ${s.enabled ? "checked" : ""} />
            <span class="toggle-track"></span>
            <span class="skill-toggle-label">${s.enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        <div class="skill-conflict-warning" style="display:none"></div>
      </div>
      <div class="skill-editor" id="skill-editor-${escapeHtml(s.name)}" style="display:none">
        <div class="skill-editor-tabs">
          <button class="skill-tab active" data-tab="md" data-skill-tab="${escapeHtml(s.name)}">SKILL.md</button>
          ${s.has_scripts ? `<button class="skill-tab" data-tab="scripts" data-skill-tab="${escapeHtml(s.name)}">Scripts</button>` : ""}
        </div>
        <div class="skill-tab-content" id="skill-tab-md-${escapeHtml(s.name)}">
          <textarea class="skill-editor-textarea" id="skill-textarea-${escapeHtml(s.name)}" rows="12"></textarea>
          <div class="skill-editor-controls">
            <span class="skill-editor-status" id="skill-status-${escapeHtml(s.name)}"></span>
            <button class="btn-sm" data-skill-close="${escapeHtml(s.name)}">Close</button>
            <button class="btn-sm btn-accent" data-skill-save="${escapeHtml(s.name)}">Save</button>
          </div>
        </div>
        <div class="skill-tab-content" id="skill-tab-scripts-${escapeHtml(s.name)}" style="display:none">
          <div class="skill-scripts-list" id="skill-scripts-${escapeHtml(s.name)}">Loading scripts...</div>
          <div class="skill-editor-controls">
            <button class="btn-sm" data-skill-close="${escapeHtml(s.name)}">Close</button>
          </div>
        </div>
      </div>`)
      .join("");

    // Attach toggle handlers
    const restartBanner = $("skill-restart-banner");
    listEl.querySelectorAll("input[data-skill]").forEach((input) => {
      input.addEventListener("change", async (e) => {
        const checkbox = e.target as HTMLInputElement;
        const skillName = checkbox.dataset.skill!;
        const action = checkbox.checked ? "enable" : "disable";
        try {
          const resp = await invoke<{ warnings?: string[] }>("proxy_post", { path: `/api/skills/${skillName}/${action}` });
          const label = checkbox.closest(".skill-toggle")?.querySelector(".skill-toggle-label");
          if (label) label.textContent = checkbox.checked ? "Enabled" : "Disabled";
          if (restartBanner) restartBanner.classList.add("visible");
          // Show conflict warnings when enabling
          const warnEl = checkbox.closest(".skill-card")?.querySelector(".skill-conflict-warning") as HTMLElement | null;
          if (warnEl) {
            if (resp.warnings && resp.warnings.length > 0) {
              warnEl.innerHTML = resp.warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join("");
              warnEl.style.display = "block";
            } else {
              warnEl.innerHTML = "";
              warnEl.style.display = "none";
            }
          }
        } catch {
          checkbox.checked = !checkbox.checked;
        }
      });
    });

    // Attach tab switching
    listEl.querySelectorAll(".skill-tab").forEach((tab) => {
      tab.addEventListener("click", async () => {
        const el = tab as HTMLElement;
        const skillName = el.dataset.skillTab!;
        const tabName = el.dataset.tab!;

        // Switch active tab
        listEl.querySelectorAll(`.skill-tab[data-skill-tab="${skillName}"]`).forEach((t) => t.classList.remove("active"));
        el.classList.add("active");

        // Show/hide content - load async content before swapping to avoid jitter
        const mdPanel = $(`skill-tab-md-${skillName}`);
        const scriptsPanel = $(`skill-tab-scripts-${skillName}`);

        if (tabName === "scripts" && scriptsPanel) {
          const scriptsList = $(`skill-scripts-${skillName}`);
          if (scriptsList && scriptsList.textContent === "Loading scripts...") {
            try {
              const resp = await invoke<{ workflows: WorkflowInfo[] }>("proxy_get", {
                path: `/api/skills/${skillName}/workflows`,
              });
              if (resp.workflows.length === 0) {
                scriptsList.innerHTML = '<p class="skill-description">No scripts found.</p>';
              } else {
                scriptsList.innerHTML = resp.workflows
                  .map((w) => {
                    const isPy = w.filename.endsWith(".py");
                    return `<div class="workflow-item">
                    <div class="workflow-header">
                      <span class="workflow-name">${escapeHtml(w.name)}</span>
                      <span class="workflow-filename">${isPy ? "python" : "yaml"} &mdash; ${escapeHtml(w.filename)}</span>
                    </div>
                    <pre class="workflow-yaml">${escapeHtml(w.content)}</pre>
                  </div>`;
                  })
                  .join("");
              }
            } catch {
              scriptsList!.innerHTML = '<p class="skill-description">Failed to load scripts.</p>';
            }
          }
          // Content ready - now swap panels atomically
          if (mdPanel) mdPanel.style.display = "none";
          scriptsPanel.style.display = "block";
        } else {
          if (scriptsPanel) scriptsPanel.style.display = "none";
          if (mdPanel) mdPanel.style.display = tabName === "md" ? "block" : "none";
        }
      });
    });

    // Attach View button handlers
    listEl.querySelectorAll(".skill-view-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const skillName = (btn as HTMLElement).dataset.skill!;
        const editorEl = $(`skill-editor-${skillName}`);
        const textareaEl = $(`skill-textarea-${skillName}`) as HTMLTextAreaElement | null;
        if (!editorEl || !textareaEl) return;

        if (editorEl.style.display !== "none") {
          editorEl.style.display = "none";
          (btn as HTMLElement).textContent = "View";
          return;
        }

        try {
          const resp = await invoke<{ content: string }>("proxy_get", { path: `/api/skills/${skillName}` });
          textareaEl.value = resp.content;
          editorEl.style.display = "block";
          (btn as HTMLElement).textContent = "Hide";
        } catch {
          editorEl.style.display = "block";
          textareaEl.value = "Failed to load skill content.";
        }
      });
    });

    // Attach Close button handlers
    listEl.querySelectorAll("[data-skill-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const skillName = (btn as HTMLElement).dataset.skillClose!;
        const editorEl = $(`skill-editor-${skillName}`);
        const viewBtn = listEl.querySelector(`.skill-view-btn[data-skill="${skillName}"]`);
        if (editorEl) editorEl.style.display = "none";
        if (viewBtn) viewBtn.textContent = "View";
      });
    });

    // Attach Save button handlers
    listEl.querySelectorAll("[data-skill-save]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const skillName = (btn as HTMLElement).dataset.skillSave!;
        const textareaEl = $(`skill-textarea-${skillName}`) as HTMLTextAreaElement | null;
        const statusEl = $(`skill-status-${skillName}`);
        if (!textareaEl) return;

        try {
          await invoke("proxy_put", {
            path: `/api/skills/${skillName}`,
            body: { content: textareaEl.value },
          });
          if (statusEl) {
            statusEl.textContent = "Saved";
            statusEl.className = "skill-editor-status saved";
            setTimeout(() => { statusEl.textContent = ""; }, 2000);
          }
        } catch (e) {
          if (statusEl) {
            statusEl.textContent = `Error: ${e}`;
            statusEl.className = "skill-editor-status error";
          }
        }
      });
    });
  } catch {
    listEl.innerHTML = '<p class="skill-description">Could not load skills. Is the server running?</p>';
    emptyEl.style.display = "none";
  }
}

// --- Initialization ---

window.addEventListener("DOMContentLoaded", async () => {
  updateStatus("stopped");

  // First-launch setup - runs GPU detection + dependency installation if needed
  // Non-blocking: runs in background so window close always works
  {
    const setupStatus = document.getElementById("setup-status");

    // Register progress listener BEFORE invoking (events stream during the invoke)
    listen<string>("setup-progress", (event) => {
      if (setupStatus) {
        try {
          const data = JSON.parse(event.payload);
          setupStatus.textContent = data.message || event.payload;
        } catch {
          setupStatus.textContent = event.payload;
        }
      }
    });

    invoke<string>("run_first_launch_setup")
      .then((result) => {
        if (result !== "ready" && setupStatus) {
          setupStatus.textContent = "Setup complete.";
        }
      })
      .catch((e) => {
        console.warn("First-launch setup error (non-fatal):", e);
        if (setupStatus) {
          setupStatus.textContent = "Setup skipped.";
        }
      });
  }

  // Ensure Python dependencies are installed (macOS/Linux first launch, or Windows NSIS fallback).
  // Disables the Start Server button until deps are verified/installed.
  // Shows a full-screen overlay with progress when installation is needed.
  {
    const overlay = document.getElementById("setup-overlay");
    const statusEl = document.getElementById("setup-status");
    const detailEl = document.getElementById("setup-detail");
    const progressBar = document.getElementById("setup-progress-bar");
    const hintEl = document.getElementById("setup-hint");
    const sBtn = document.getElementById("start-btn") as HTMLButtonElement | null;

    const showOverlay = () => {
      if (overlay) overlay.style.display = "flex";
    };
    const hideOverlay = (delay = 0) => {
      setTimeout(() => {
        if (overlay) overlay.style.display = "none";
      }, delay);
    };

    // Progress bar stages: gpu-detect=10%, installing=20%, progress=20-90%, done=100%
    const setProgress = (pct: number) => {
      if (progressBar) progressBar.style.width = `${pct}%`;
    };
    let progressPct = 0;

    listen<string>("dep-install-progress", (event) => {
      try {
        const data = JSON.parse(event.payload);
        showOverlay();

        if (data.stage === "gpu-detect") {
          if (statusEl) statusEl.textContent = data.message;
          setProgress(10);
        } else if (data.stage === "installing") {
          if (statusEl) statusEl.textContent = data.message;
          if (hintEl) hintEl.textContent = data.detail;
          setProgress(20);
          progressPct = 20;
        } else if (data.stage === "progress") {
          if (statusEl) statusEl.textContent = data.message;
          if (detailEl) detailEl.textContent = data.detail;
          // Slowly increment progress bar during uv output (caps at 90%)
          progressPct = Math.min(90, progressPct + 0.5);
          setProgress(progressPct);
        } else if (data.stage === "done") {
          if (statusEl) statusEl.textContent = data.message;
          if (detailEl) detailEl.textContent = "";
          if (hintEl) hintEl.textContent = "";
          setProgress(100);
          hideOverlay(2000);
        } else if (data.stage === "error") {
          if (statusEl) statusEl.textContent = data.message;
          if (detailEl) detailEl.textContent = data.detail;
          if (hintEl) hintEl.textContent = "You can still try starting the server.";
          setProgress(0);
          hideOverlay(5000);
        }
      } catch {
        // Fallback for non-JSON payloads
        showOverlay();
        if (statusEl) statusEl.textContent = event.payload;
      }
    });

    if (sBtn) sBtn.disabled = true;
    invoke<string>("ensure_dependencies_installed")
      .then((result) => {
        if (result === "ready") {
          // Already installed - don't show overlay at all
        } else if (statusEl) {
          statusEl.textContent = "Dependencies ready.";
          setProgress(100);
          hideOverlay(2000);
        }
        if (sBtn) sBtn.disabled = false;
      })
      .catch((e) => {
        console.error("Dependency install failed:", e);
        showOverlay();
        if (statusEl) statusEl.textContent = "Dependency installation failed.";
        if (detailEl) detailEl.textContent = String(e);
        if (hintEl) hintEl.textContent = "You can still try starting the server. The app will retry on next launch.";
        setProgress(0);
        if (sBtn) sBtn.disabled = false;
      });
  }

  // Check for updates (non-blocking)
  try {
    const update = await check();
    if (update) {
      const toast = document.getElementById("update-toast");
      const versionEl = document.getElementById("update-version");
      if (toast && versionEl) {
        versionEl.textContent = update.version;
        toast.style.display = "flex";
        document.getElementById("update-restart")?.addEventListener("click", async () => {
          await update.downloadAndInstall();
          await invoke("plugin:process|restart");
        });
        document.getElementById("update-dismiss")?.addEventListener("click", () => {
          toast.style.display = "none";
        });
      }
    }
  } catch (e) {
    console.warn("Update check failed (non-fatal):", e);
  }

  // Page navigation - refresh settings data when entering Settings page
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const page = (btn as HTMLElement).dataset.page;
      if (page) {
        navigateTo(page);
        if (page === "settings") {
          try {
            const settings = await invoke<Settings>("load_settings");
            currentSettings = settings;
            renderSettings(settings);
          } catch {
            // Use cached settings
          }
          loadAwayModeUI();
        }
        if (page === "skills") {
          await loadSkills();
        }
        if (page === "devices") {
          await pollDevices();
        }
      }
    });
  });

  // Server controls
  startBtn().addEventListener("click", startServer);
  stopBtn().addEventListener("click", stopServer);
  restartBtn().addEventListener("click", restartServer);

  // Away Mode controls
  initAwayModeControls();

  // Proxy auto-start toggle
  $("proxy-autostart-toggle").addEventListener("click", () => {
    const btn = $("proxy-autostart-toggle") as HTMLButtonElement;
    const newVal = btn.dataset.on !== "true";
    btn.dataset.on = String(newVal);
    btn.textContent = newVal ? "On" : "Off";
  });

  // Subscription proxy controls: Start/Stop/Test per provider
  for (const provider of ["anthropic", "gemini", "openai"] as const) {
    $(`sub-start-${provider}`).addEventListener("click", async () => {
      const statusEl = $(`sub-status-${provider}`);
      const portInput = $(`sub-port-${provider}`) as HTMLInputElement;
      const port = parseInt(portInput.value, 10) || undefined;
      userStoppedProxies.delete(provider);
      try {
        await invoke("start_proxy", { provider, port });
        updateProxyStatusUI(provider, "starting");
        // Set mode to cli_proxy and persist the port
        if (currentSettings?.provider_auth) {
          currentSettings.provider_auth[provider] = {
            mode: "cli_proxy",
            proxy_url: `http://localhost:${port ?? portInput.value}`,
          };
          void invoke("save_settings", { settings: currentSettings }).catch(() => { });
        }
        statusEl.textContent = "Launching…";
        statusEl.className = "sub-status";
        updateApiKeyPrompt(currentSettings?.gemini_api_key ?? "");
        // Verify actual health after proxy has time to bind its port (fast + slow check)
        const checkHealth = async () => {
          try {
            const r = await invoke<{ status: string }>("proxy_status", { provider });
            const s = r.status as "running" | "stopped" | "degraded" | "starting";
            updateProxyStatusUI(provider, s);
            if (s === "running") {
              statusEl.textContent = "Connected";
              statusEl.className = "sub-status sub-ok";
            } else if (s === "stopped" || s === "degraded") {
              statusEl.textContent = s === "degraded" ? "CLI session failed" : "Process exited - check logs";
              statusEl.className = "sub-status sub-error";
            }
            // "starting" - leave "Launching…" text, next check will resolve
          } catch { /* */ }
        };
        setTimeout(() => { void checkHealth(); void notifyProxyChange(); }, 2000);
        setTimeout(() => void checkHealth(), 5000);
      } catch (e) {
        statusEl.textContent = String(e).split(":").pop()?.trim() || "Failed to start";
        statusEl.className = "sub-status sub-error";
      }
    });

    $(`sub-stop-${provider}`).addEventListener("click", async () => {
      const statusEl = $(`sub-status-${provider}`);
      try {
        await invoke("stop_proxy", { provider });
        userStoppedProxies.add(provider);
      } catch {
        // stop_proxy failed - don't add to Set so watchdog can still manage it
      }
      // Set mode back to api_key
      if (currentSettings?.provider_auth) {
        currentSettings.provider_auth[provider].mode = "api_key";
        void invoke("save_settings", { settings: currentSettings }).catch(() => { });
      }
      updateProxyStatusUI(provider, "stopped");
      updateApiKeyPrompt(currentSettings?.gemini_api_key ?? "");
      statusEl.textContent = "Stopped";
      statusEl.className = "sub-status";
      void notifyProxyChange();
      setTimeout(() => { statusEl.textContent = ""; }, 2000);
    });

    $(`sub-test-${provider}`).addEventListener("click", async () => {
      const statusEl = $(`sub-status-${provider}`);
      statusEl.textContent = "Testing…";
      statusEl.className = "sub-status";
      try {
        const result = await invoke<{ status: string; message?: string }>("proxy_post", {
          path: "/api/provider-health",
          body: { provider },
        });
        if (result.status === "ok") {
          statusEl.textContent = "Connected";
          statusEl.className = "sub-status sub-ok";
        } else {
          statusEl.textContent = result.message ?? "Error";
          statusEl.className = "sub-status sub-error";
        }
      } catch (e) {
        statusEl.textContent = String(e).includes("running") ? "Server not running" : "Unreachable";
        statusEl.className = "sub-status sub-error";
      }
      setTimeout(() => { statusEl.textContent = ""; statusEl.className = "sub-status"; }, 5000);
    });
  }

  // Settings controls
  $("add-path-btn").addEventListener("click", addRestrictedPath);
  $("add-command-btn").addEventListener("click", addForbiddenCommand);
  $("save-settings-btn").addEventListener("click", saveSettings);
  $("restore-defaults-btn").addEventListener("click", restoreDefaults);
  $("toggle-key-visibility").addEventListener("click", () => {
    const input = $("gemini-key-input") as HTMLInputElement;
    const btn = $("toggle-key-visibility") as HTMLButtonElement;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  $("toggle-openrouter-visibility").addEventListener("click", () => {
    const input = $("openrouter-key-input") as HTMLInputElement;
    const btn = $("toggle-openrouter-visibility") as HTMLButtonElement;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  $("toggle-openai-visibility").addEventListener("click", () => {
    const input = $("openai-key-input") as HTMLInputElement;
    const btn = $("toggle-openai-visibility") as HTMLButtonElement;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  $("toggle-anthropic-visibility").addEventListener("click", () => {
    const input = $("anthropic-key-input") as HTMLInputElement;
    const btn = $("toggle-anthropic-visibility") as HTMLButtonElement;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  // API key prompt handlers
  $("prompt-key-save").addEventListener("click", savePromptApiKey);
  $("prompt-key-toggle").addEventListener("click", () => {
    const input = $("prompt-key-input") as HTMLInputElement;
    const btn = $("prompt-key-toggle") as HTMLButtonElement;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  // Forget connection button
  $("forget-connection-btn").addEventListener("click", async () => {
    if (!await appConfirm("Forget the paired device? The mobile app will need to scan a new QR code.")) return;
    await performForgetCleanup();
  });

  // Manual details toggle
  $("manual-details-toggle").addEventListener("click", () => {
    const details = $("manual-details");
    const btn = $("manual-details-toggle") as HTMLButtonElement;
    if (details.style.display === "none") {
      details.style.display = "";
      btn.textContent = "Hide manual details";
    } else {
      details.style.display = "none";
      btn.textContent = "Can't scan? Enter manually";
    }
  });

  // Copy token to clipboard
  $("copy-token-btn").addEventListener("click", () => {
    const tokenEl = $("manual-token");
    const text = tokenEl.textContent ?? "";
    if (text && text !== "-") {
      navigator.clipboard.writeText(text);
      const btn = $("copy-token-btn") as HTMLButtonElement;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 1500);
    }
  });

  // Temp QR button - start tunnel on demand, then generate a temp QR code.
  // Also handles "Show QR" re-display when temp device already connected.
  $("temp-qr-btn").addEventListener("click", async () => {
    const btn = $("temp-qr-btn") as HTMLButtonElement;
    const notice = $("qr-notice");

    // "Show QR" mode: tunnel already active, just re-show the existing QR image
    if (showingTempQR && currentBlobUrl) {
      qrImage().src = currentBlobUrl;
      qrImage().style.display = "block";
      qrPlaceholder().style.display = "none";
      $("paired-status").style.display = "none";
      btn.style.display = "none";
      $("cancel-temp-qr-btn").style.display = "";
      notice.textContent = "Temp QR code \u2014 expires in 4 hours. Scan from any device for a temporary session.";
      notice.style.display = "block";
      return;
    }

    showingTempQR = true;
    minClientsSinceTempQR = lastKnownClients;
    tempDeviceConnected = false;
    btn.disabled = true;
    btn.textContent = "Starting tunnel...";
    $("paired-status").style.display = "none";

    try {
      // Start the Cloudflare tunnel on demand (may take up to 30s on first run)
      await invoke("start_tunnel");
      btn.textContent = "Generating QR...";
      await fetchQRCode(true, "temp");
      btn.style.display = "none";
      $("cancel-temp-qr-btn").style.display = "";
      notice.textContent = "Temp QR code \u2014 expires in 4 hours. Scan from any device for a temporary session.";
      notice.style.display = "block";
      // Poll faster while waiting for temp device to scan
      startConnectionInfoPolling(2000);
    } catch (e) {
      showingTempQR = false;
      btn.disabled = false;
      btn.textContent = "Generate Temp QR";
      notice.textContent = `Failed to generate temp QR: ${e}`;
      notice.style.display = "block";
    }
  });

  // Cancel temp QR - switch back to permanent QR mode
  $("cancel-temp-qr-btn").addEventListener("click", async () => {
    showingTempQR = false;
    tempDeviceConnected = false;
    minClientsSinceTempQR = 0;

    const cancelBtn = $("cancel-temp-qr-btn");
    cancelBtn.style.display = "none";

    const tempBtn = $("temp-qr-btn") as HTMLButtonElement;
    tempBtn.textContent = "Generate Temp QR";
    tempBtn.disabled = false;
    tempBtn.style.display = "";

    const notice = $("qr-notice");
    notice.style.display = "none";

    // Regenerate the permanent QR
    try { await fetchQRCode(true); } catch { /* server may have stopped */ }
    // Revert to normal polling
    startConnectionInfoPolling();
  });

  // Setup page external links
  const openExternal = async (url: string) => {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  };

  $("tailscale-signup-link").addEventListener("click", () => openExternal("https://login.tailscale.com/start"));
  $("tailscale-download-link").addEventListener("click", () => openExternal("https://tailscale.com/download"));
  $("docker-download-link").addEventListener("click", () => openExternal("https://www.docker.com/products/docker-desktop/"));

  // Load settings and check API key on startup
  try {
    const settings = await invoke<Settings>("load_settings");
    currentSettings = settings;
    updateApiKeyPrompt(settings.gemini_api_key);
    renderSettings(settings);
  } catch {
    updateApiKeyPrompt("");
  }

  // Check if server is already running (e.g. after a UI refresh)
  try {
    const alreadyHealthy = await invoke<boolean>("check_server_health");
    if (alreadyHealthy) {
      updateStatus("running");
      startBtn().disabled = true;
      stopBtn().disabled = false;
      activeApiKey = currentSettings?.gemini_api_key || "";
      showConnectionInfo();
      const wasForgetPending = pendingForgetRevoke;
      pendingForgetRevoke = false;
      try { await fetchQRCode(true); } catch { /* QR fetch failed - error shown in placeholder */ }
      startConnectionInfoPolling(wasForgetPending ? 1000 : 5000);
    }
  } catch {
    // Server not running - keep "stopped" state
  }

  // Home page is default - the API key prompt card is visible there if no key is set
  if (!hasApiKey) {
    navigateTo("home");
  }

  // NOTE: Do NOT register onCloseRequested here. Tauri v2 automatically calls
  // api.prevent_close() when ANY JS listener exists for the close-requested event,
  // which prevents the native window close and requires JS to call window.destroy()
  // via IPC. If the Rust ExitRequested handler blocks the event loop (e.g. waiting
  // for child processes to die), the IPC response never arrives → deadlock.
  // Timer cleanup is unnecessary since the process is exiting.
});
