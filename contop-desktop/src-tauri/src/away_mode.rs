//! Away Mode — physical access protection with continuous automation.
//!
//! Provides:
//! - PIN setup/verification (bcrypt hashed, async via spawn_blocking) [F10]
//! - Cross-platform credential encryption via `keyring` crate (Keychain/Secret Service/Credential Manager)
//! - Fullscreen overlay window (WDA_EXCLUDEFROMCAPTURE on Windows, NSWindow.sharingType on macOS)
//! - Platform-specific keyboard blocking:
//!   - Windows: Low-level keyboard hook (WH_KEYBOARD_LL)
//!   - macOS: NSApplication presentationOptions + CGEventTap
//!   - Linux X11: XGrabKeyboard / Linux Wayland: Tauri fullscreen focus
//! - Idle timeout monitoring (GetLastInputInfo / IOKit HIDIdleTime / XScreenSaverQueryInfo)
//! - Lightweight HTTP health server for watchdog with engage/disengage routes [F3]

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

// ── State ──

pub static AWAY_MODE_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Separate from AWAY_MODE_ACTIVE — tracks whether the overlay window exists.
/// The health server reads this independently so the watchdog can detect
/// "away mode active but overlay crashed". [F8]
static OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Keyring-stored key prefix — used to detect already-migrated keys.
const KEYRING_PREFIX: &str = "keyring:";

/// Legacy DPAPI prefix — used for backward-compatible migration on Windows.
#[cfg(target_os = "windows")]
const DPAPI_PREFIX: &str = "dpapi:";

/// Service name for keyring entries.
const KEYRING_SERVICE: &str = "contop";

/// Mutex protecting settings.json read-modify-write cycles. [F9]
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

/// Shared state for Away Mode, managed by Tauri.
pub struct AwayModeState {
    pub overlay_active: AtomicBool,
    /// Platform-specific input blocking handle.
    /// Windows: keyboard hook HHOOK as isize
    /// macOS: CGEventTap CFMachPort as isize
    /// Linux: sentinel value (1 = active, XGrabKeyboard has no handle)
    pub input_block_handle: Mutex<Option<isize>>,
    pub health_server_running: AtomicBool,
    /// App handle stored for health server engage/disengage routes. [F3/F5]
    pub app_handle: Mutex<Option<AppHandle>>,
}

impl Default for AwayModeState {
    fn default() -> Self {
        Self {
            overlay_active: AtomicBool::new(false),
            input_block_handle: Mutex::new(None),
            health_server_running: AtomicBool::new(false),
            app_handle: Mutex::new(None),
        }
    }
}

// ── Settings schema ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwayModeConfig {
    pub enabled: bool,
    pub pin_hash: String,
    pub emergency_pin_hash: String,
    pub auto_engage_minutes: u32,
    pub idle_timeout_enabled: bool,
}

impl Default for AwayModeConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            pin_hash: String::new(),
            emergency_pin_hash: String::new(),
            auto_engage_minutes: 5,
            idle_timeout_enabled: true,
        }
    }
}

// ── PIN commands (async with spawn_blocking for bcrypt) [F10] ──

/// Hash a PIN and store it in settings as the away_mode.pin_hash.
#[tauri::command]
pub async fn set_away_pin(pin: String) -> Result<(), String> {
    if pin.len() < 4 || pin.len() > 12 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN must be 4-12 digits".into());
    }
    let hash = tauri::async_runtime::spawn_blocking(move || {
        bcrypt::hash(&pin, 10).map_err(|e| format!("Hash error: {e}"))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;
    update_away_config(|cfg| cfg.pin_hash = hash)?;
    Ok(())
}

/// Verify a PIN against the stored hash.
#[tauri::command]
pub async fn verify_away_pin(pin: String) -> Result<bool, String> {
    let cfg = load_away_config()?;
    if cfg.pin_hash.is_empty() {
        return Err("No PIN configured".into());
    }
    let hash = cfg.pin_hash.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(bcrypt::verify(&pin, &hash).unwrap_or(false))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Set the emergency recovery PIN.
#[tauri::command]
pub async fn set_emergency_pin(pin: String) -> Result<(), String> {
    if pin.len() < 6 || pin.len() > 12 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("Emergency PIN must be 6-12 digits".into());
    }
    let hash = tauri::async_runtime::spawn_blocking(move || {
        bcrypt::hash(&pin, 10).map_err(|e| format!("Hash error: {e}"))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;
    update_away_config(|cfg| cfg.emergency_pin_hash = hash)?;
    Ok(())
}

/// Check if Away Mode has a PIN configured.
#[tauri::command]
pub fn has_away_pin() -> Result<bool, String> {
    let cfg = load_away_config()?;
    Ok(!cfg.pin_hash.is_empty())
}

/// Get current Away Mode configuration (without hashes).
#[tauri::command]
pub fn get_away_mode_config() -> Result<serde_json::Value, String> {
    let cfg = load_away_config()?;
    Ok(serde_json::json!({
        "enabled": cfg.enabled,
        "has_pin": !cfg.pin_hash.is_empty(),
        "has_emergency_pin": !cfg.emergency_pin_hash.is_empty(),
        "auto_engage_minutes": cfg.auto_engage_minutes,
        "idle_timeout_enabled": cfg.idle_timeout_enabled,
    }))
}

/// Update Away Mode settings (enable/disable, idle timeout config).
#[tauri::command]
pub fn update_away_mode_settings(
    enabled: Option<bool>,
    auto_engage_minutes: Option<u32>,
    idle_timeout_enabled: Option<bool>,
) -> Result<(), String> {
    update_away_config(|cfg| {
        if let Some(e) = enabled {
            cfg.enabled = e;
        }
        if let Some(m) = auto_engage_minutes {
            cfg.auto_engage_minutes = m;
        }
        if let Some(t) = idle_timeout_enabled {
            cfg.idle_timeout_enabled = t;
        }
    })
}

// ── Overlay Window ──

/// Engage Away Mode: create fullscreen overlay, install keyboard block on main thread. [F4]
#[tauri::command]
pub async fn engage_away_mode(
    app: AppHandle,
    _state: State<'_, AwayModeState>,
) -> Result<(), String> {
    let cfg = load_away_config()?;
    if cfg.pin_hash.is_empty() {
        return Err("Cannot engage Away Mode: no PIN configured".into());
    }
    if AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
        return Ok(()); // already active
    }

    // Must run overlay creation and keyboard blocking on the main thread. [F4]
    let app_for_closure = app.clone();
    app.run_on_main_thread(move || {
        // Re-check inside main thread closure to prevent double-engage from concurrent calls
        if AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
            return;
        }
        if let Err(e) = create_overlay_window(&app_for_closure) {
            eprintln!("Failed to create overlay: {e}");
            return;
        }
        OVERLAY_ACTIVE.store(true, Ordering::SeqCst);
        AWAY_MODE_ACTIVE.store(true, Ordering::SeqCst);

        if let Some(s) = app_for_closure.try_state::<AwayModeState>() {
            s.overlay_active.store(true, Ordering::SeqCst);
            if let Ok(handle) = install_keyboard_block() {
                if let Ok(mut guard) = s.input_block_handle.lock() {
                    *guard = Some(handle);
                }
            }
        }
    })
    .map_err(|e| format!("Failed to engage on main thread: {e}"))?;

    Ok(())
}

/// Disengage Away Mode: close overlay, remove keyboard block.
/// PIN is always required for IPC callers. Phone-initiated unlock goes
/// through the health server route (localhost-only) which bypasses PIN. [F12]
#[tauri::command]
pub async fn disengage_away_mode(
    app: AppHandle,
    _state: State<'_, AwayModeState>,
    pin: String,
) -> Result<(), String> {
    if !AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
        return Ok(());
    }

    // IPC callers always require PIN verification
    let cfg = load_away_config()?;
    let pin_hash = cfg.pin_hash.clone();
    let emergency_hash = cfg.emergency_pin_hash.clone();
    let valid = tauri::async_runtime::spawn_blocking(move || {
        let pin_ok = bcrypt::verify(&pin, &pin_hash).unwrap_or(false);
        let emergency_ok = if !emergency_hash.is_empty() {
            bcrypt::verify(&pin, &emergency_hash).unwrap_or(false)
        } else {
            false
        };
        pin_ok || emergency_ok
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?;
    if !valid {
        return Err("Invalid PIN".into());
    }

    // Remove keyboard block and close overlay on main thread [F4]
    let app_for_closure = app.clone();
    app.run_on_main_thread(move || {
        if let Some(s) = app_for_closure.try_state::<AwayModeState>() {
            if let Ok(mut guard) = s.input_block_handle.lock() {
                if let Some(handle) = guard.take() {
                    remove_keyboard_block(handle);
                }
            }
            s.overlay_active.store(false, Ordering::SeqCst);
        }
        close_overlay_window(&app_for_closure);
        OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
        AWAY_MODE_ACTIVE.store(false, Ordering::SeqCst);
    })
    .map_err(|e| format!("Failed to disengage on main thread: {e}"))?;

    Ok(())
}

/// Get the current Away Mode status.
#[tauri::command]
pub fn get_away_mode_status(_state: State<'_, AwayModeState>) -> serde_json::Value {
    serde_json::json!({
        "away_mode": AWAY_MODE_ACTIVE.load(Ordering::SeqCst),
        "overlay_active": OVERLAY_ACTIVE.load(Ordering::SeqCst),
    })
}

// ── Overlay Window Implementation ──

fn create_overlay_window(app: &AppHandle) -> Result<(), String> {
    close_overlay_window(app);

    let overlay = WebviewWindowBuilder::new(
        app,
        "away-overlay",
        WebviewUrl::App("away-overlay.html".into()),
    )
    .title("")
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .minimizable(false)
    .closable(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e| format!("Failed to create overlay: {e}"))?;

    // Platform-specific capture exclusion
    #[cfg(target_os = "windows")]
    {
        let hwnd = overlay
            .hwnd()
            .map_err(|e| format!("Failed to get overlay hwnd: {e}"))?;
        apply_exclude_from_capture(hwnd.0 as isize);
    }

    #[cfg(target_os = "macos")]
    {
        macos_overlay::apply_sharing_type_none(&overlay)?;
    }

    // Let mouse events pass through so pyautogui and phone manual-control
    // clicks reach the desktop. Physical attackers still can't do anything
    // useful — overlay is visually opaque and keyboard block blocks all keys.
    let _ = overlay.set_ignore_cursor_events(true);
    Ok(())
}

fn close_overlay_window(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("away-overlay") {
        let _ = overlay.close();
    }
}

// ── Keyring-based Credential Storage (cross-platform) ──

fn keyring_store(key_name: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key_name)
        .map_err(|e| format!("Keyring entry error for {key_name}: {e}"))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Keyring store error for {key_name}: {e}"))
}

fn keyring_retrieve(key_name: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key_name)
        .map_err(|e| format!("Keyring entry error for {key_name}: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("Keyring retrieve error for {key_name}: {e}"))
}

/// Encrypt a string using keyring (cross-platform secure storage).
/// `key_name` identifies the keyring slot (e.g. "gemini_api_key").
/// If omitted, a timestamp-based unique name is generated.
/// Command name kept as `encrypt_dpapi` for frontend compatibility.
#[tauri::command]
pub fn encrypt_dpapi(plaintext: String, key_name: Option<String>) -> Result<String, String> {
    let name = key_name.unwrap_or_else(|| {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("_adhoc_{}", ts)
    });
    keyring_store(&name, &plaintext)?;
    Ok(format!("{}{}", KEYRING_PREFIX, name))
}

/// Decrypt a keyring-stored secret.
/// Command name kept as `decrypt_dpapi` for frontend compatibility.
#[tauri::command]
pub fn decrypt_dpapi(encrypted: String) -> Result<String, String> {
    if let Some(key_name) = encrypted.strip_prefix(KEYRING_PREFIX) {
        keyring_retrieve(key_name)
    } else {
        // Legacy DPAPI migration path (Windows only)
        #[cfg(target_os = "windows")]
        {
            if let Some(blob) = encrypted.strip_prefix(DPAPI_PREFIX) {
                return dpapi::decrypt(blob);
            }
        }
        // Plaintext fallback
        Ok(encrypted)
    }
}

/// Get all API keys decrypted (for Python server to call at startup).
#[tauri::command]
pub fn get_decrypted_api_keys() -> Result<serde_json::Value, String> {
    let _lock = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = super::settings_path()?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))?;
    let settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON parse error: {e}"))?;

    let key_fields = [
        "gemini_api_key",
        "openai_api_key",
        "anthropic_api_key",
        "openrouter_api_key",
    ];

    let mut result = serde_json::Map::new();
    for field in &key_fields {
        let value = settings
            .get(*field)
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if value.is_empty() {
            result.insert(field.to_string(), serde_json::Value::String(String::new()));
            continue;
        }
        let decrypted = if let Some(key_name) = value.strip_prefix(KEYRING_PREFIX) {
            // Value is in keyring — retrieve by the key name stored in the marker
            keyring_retrieve(key_name).unwrap_or_else(|_| value.to_string())
        } else {
            #[cfg(target_os = "windows")]
            {
                // Legacy DPAPI path
                if let Some(blob) = value.strip_prefix(DPAPI_PREFIX) {
                    dpapi::decrypt(blob).unwrap_or_else(|_| value.to_string())
                } else {
                    value.to_string()
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                value.to_string()
            }
        };
        result.insert(field.to_string(), serde_json::Value::String(decrypted));
    }

    Ok(serde_json::Value::Object(result))
}

/// Migrate plaintext (and legacy DPAPI) API keys to keyring-based storage.
#[tauri::command]
/// Reverse-migrate: recover any keyring/DPAPI markers back to plaintext in settings.json.
/// Called once on startup so keys are always stored as plain strings going forward.
pub fn migrate_keys_to_plaintext() -> Result<(), String> {
    let _lock = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = super::settings_path()?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON parse error: {e}"))?;

    let key_fields = [
        "gemini_api_key",
        "openai_api_key",
        "anthropic_api_key",
        "openrouter_api_key",
    ];

    let obj = settings
        .as_object_mut()
        .ok_or("Settings is not an object")?;
    let mut changed = false;
    for field in &key_fields {
        let val = match obj.get(*field).and_then(|v| v.as_str()).map(String::from) {
            Some(v) if !v.is_empty() => v,
            _ => continue,
        };

        if let Some(key_name) = val.strip_prefix(KEYRING_PREFIX) {
            // Try to recover the key from OS keyring
            match keyring_retrieve(key_name) {
                Ok(plaintext) => {
                    obj.insert(field.to_string(), serde_json::Value::String(plaintext));
                    // Best-effort cleanup of keyring entry
                    let _ = keyring::Entry::new(KEYRING_SERVICE, key_name)
                        .and_then(|e| e.delete_credential());
                }
                Err(_) => {
                    // Key lost from keyring — clear the broken marker
                    eprintln!("Warning: keyring entry for {field} is gone, clearing marker");
                    obj.insert(field.to_string(), serde_json::Value::String(String::new()));
                }
            }
            changed = true;
        }

        #[cfg(target_os = "windows")]
        if let Some(blob) = val.strip_prefix(DPAPI_PREFIX) {
            match dpapi::decrypt(blob) {
                Ok(plaintext) => {
                    obj.insert(field.to_string(), serde_json::Value::String(plaintext));
                    changed = true;
                }
                Err(_) => {
                    eprintln!("Warning: DPAPI decrypt failed for {field}, clearing marker");
                    obj.insert(field.to_string(), serde_json::Value::String(String::new()));
                    changed = true;
                }
            }
        }
    }

    if changed {
        let pretty =
            serde_json::to_string_pretty(&settings).map_err(|e| format!("Serialize error: {e}"))?;
        std::fs::write(&path, pretty).map_err(|e| format!("Write error: {e}"))?;
    }
    Ok(())
}

// ── DPAPI Encryption (Windows only, kept for backward-compatible migration) ──

#[cfg(target_os = "windows")]
#[allow(dead_code)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    pub fn encrypt(plaintext: &str) -> Result<String, String> {
        use base64::Engine;
        // Copy to mutable buffer to avoid const-to-mutable cast UB [F13]
        let mut data = plaintext.as_bytes().to_vec();
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_mut_ptr(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        let success = unsafe {
            CryptProtectData(&mut input, None, None, None, None, 0, &mut output)
        };

        if success.is_err() {
            return Err("DPAPI CryptProtectData failed".into());
        }

        let encrypted =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
        let encoded = base64::engine::general_purpose::STANDARD.encode(encrypted);

        unsafe {
            let _ = LocalFree(HLOCAL(output.pbData as *mut _));
        }

        Ok(encoded)
    }

    pub fn decrypt(encrypted_b64: &str) -> Result<String, String> {
        use base64::Engine;
        let mut encrypted = base64::engine::general_purpose::STANDARD
            .decode(encrypted_b64)
            .map_err(|e| format!("Base64 decode error: {e}"))?;

        let mut input = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_mut_ptr(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        let success = unsafe {
            CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
        };

        if success.is_err() {
            return Err("DPAPI CryptUnprotectData failed".into());
        }

        let decrypted =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
        let plaintext = String::from_utf8(decrypted.to_vec())
            .map_err(|e| format!("UTF-8 decode error: {e}"))?;

        unsafe {
            let _ = LocalFree(HLOCAL(output.pbData as *mut _));
        }

        Ok(plaintext)
    }
}

// ── macOS Overlay Capture Exclusion ──

#[cfg(target_os = "macos")]
mod macos_overlay {
    use cocoa::appkit::NSWindow;
    use cocoa::base::id;
    use objc::msg_send;
    use objc::sel;
    use objc::sel_impl;

    pub fn apply_sharing_type_none(
        overlay: &tauri::WebviewWindow,
    ) -> Result<(), String> {
        let ns_window: id = overlay
            .ns_window()
            .map_err(|e| format!("ns_window: {e}"))? as id;
        unsafe {
            // NSWindowSharingNone = 0 — exclude from screen capture (pre-Sequoia)
            let _: () = msg_send![ns_window, setSharingType: 0i64];
        }
        Ok(())
    }
}

// ── macOS Keyboard Blocking ──

#[cfg(target_os = "macos")]
mod macos_input {
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    };
    use std::sync::atomic::Ordering;

    /// Install macOS keyboard blocking:
    /// 1. Set NSApplication presentationOptions for kiosk mode (blocks Cmd+Tab etc.)
    /// 2. Create CGEventTap to filter individual keypresses (only allow digits, backspace, return)
    pub fn install_keyboard_block() -> Result<isize, String> {
        // Step 1: Set presentationOptions for kiosk mode
        set_kiosk_presentation_options(true);

        // Step 2: Check Input Monitoring permission
        let has_permission = unsafe {
            core_graphics::event::CGPreflightListenEventAccess()
        };

        if !has_permission {
            eprintln!(
                "Warning: Input Monitoring permission not granted. \
                 Using presentationOptions-only fallback (partial keyboard blocking)."
            );
            // Return sentinel — presentationOptions are still active
            return Ok(0);
        }

        // Step 3: Create CGEventTap
        let event_mask = (1u64 << CGEventType::KeyDown as u64)
            | (1u64 << CGEventType::KeyUp as u64)
            | (1u64 << CGEventType::FlagsChanged as u64);

        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            event_mask,
            |_proxy, event_type, event| {
                if !super::AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
                    return Some(event.clone());
                }
                // Allow only digit keys (keycodes 18-29 for 0-9), backspace (51), and return (36, 76)
                let keycode = event.get_integer_value_field(
                    core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                ) as u16;

                // macOS keycodes: digits are NOT sequential (24=`=`, 27=`-` are in the range)
                let allowed = matches!(
                    keycode,
                    18 | 19 | 20 | 21 | 22 | 23 | 25 | 26 | 28 | 29 // digit keys 1-0
                    | 82 | 83 | 84 | 85 | 86 | 87 | 88 | 89 | 91 | 92 // numpad 0-9 (90=decimal excluded)
                    | 51 | 36 | 76 // backspace, return, numpad enter
                );

                if allowed || matches!(event_type, CGEventType::FlagsChanged) {
                    Some(event.clone())
                } else {
                    None // swallow the event
                }
            },
        );

        match tap {
            Ok(tap) => {
                tap.enable();
                // The tap keeps running on the current run loop.
                // Store the port as our handle.
                let port = tap.mach_port as isize;
                // Leak the tap to keep it alive — we'll disable it on disengage
                std::mem::forget(tap);
                Ok(port)
            }
            Err(_) => {
                eprintln!("Warning: Failed to create CGEventTap, using presentationOptions-only.");
                Ok(0)
            }
        }
    }

    /// Remove macOS keyboard blocking and release resources.
    pub fn remove_keyboard_block(handle: isize) {
        // Reset presentationOptions
        set_kiosk_presentation_options(false);

        if handle != 0 {
            unsafe {
                extern "C" {
                    fn CFMachPortInvalidate(port: *mut std::ffi::c_void);
                    fn CFRelease(cf: *const std::ffi::c_void);
                }
                // Disable the event tap, invalidate the mach port, release the CF object
                core_graphics::event::CGEventTapEnable(handle as *mut _, false);
                CFMachPortInvalidate(handle as *mut std::ffi::c_void);
                CFRelease(handle as *const std::ffi::c_void);
            }
        }
    }

    fn set_kiosk_presentation_options(enable: bool) {
        use cocoa::appkit::{NSApp, NSApplication, NSApplicationPresentationOptions};
        use cocoa::base::nil;
        use objc::msg_send;
        use objc::sel;
        use objc::sel_impl;

        unsafe {
            let app = NSApp();
            if enable {
                let options = NSApplicationPresentationOptions::NSApplicationPresentationHideDock
                    | NSApplicationPresentationOptions::NSApplicationPresentationHideMenuBar
                    | NSApplicationPresentationOptions::NSApplicationPresentationDisableProcessSwitching
                    | NSApplicationPresentationOptions::NSApplicationPresentationDisableForceQuit
                    | NSApplicationPresentationOptions::NSApplicationPresentationDisableSessionTermination
                    | NSApplicationPresentationOptions::NSApplicationPresentationDisableAppleMenu;
                let _: () = msg_send![app, setPresentationOptions: options];
            } else {
                let options = NSApplicationPresentationOptions::NSApplicationPresentationDefault;
                let _: () = msg_send![app, setPresentationOptions: options];
            }
        }
    }
}

// ── macOS Idle Time Detection ──

#[cfg(target_os = "macos")]
pub fn get_idle_time_ms() -> u32 {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionaryRef;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use std::os::raw::c_uint;

    extern "C" {
        fn IOServiceGetMatchingService(
            master_port: c_uint,
            matching: *const std::ffi::c_void,
        ) -> c_uint;
        fn IOServiceMatching(name: *const std::os::raw::c_char) -> *const std::ffi::c_void;
        fn IORegistryEntryCreateCFProperties(
            entry: c_uint,
            properties: *mut CFDictionaryRef,
            allocator: *const std::ffi::c_void,
            options: c_uint,
        ) -> i32;
        fn IOObjectRelease(object: c_uint) -> i32;
    }

    unsafe {
        let service_name = b"IOHIDSystem\0".as_ptr() as *const std::os::raw::c_char;
        let matching = IOServiceMatching(service_name);
        if matching.is_null() {
            return 0;
        }
        let service = IOServiceGetMatchingService(0, matching);
        if service == 0 {
            return 0;
        }

        let mut properties: CFDictionaryRef = std::ptr::null();
        let result =
            IORegistryEntryCreateCFProperties(service, &mut properties, std::ptr::null(), 0);
        IOObjectRelease(service);

        if result != 0 || properties.is_null() {
            return 0;
        }

        let props = core_foundation::dictionary::CFDictionary::wrap_under_create_rule(properties);
        let key = CFString::new("HIDIdleTime");

        if let Some(value) = props.find(key.as_CFType().as_CFTypeRef()) {
            let cf_number: CFNumber =
                CFNumber::wrap_under_get_rule(*value as core_foundation::number::CFNumberRef);
            if let Some(nanos) = cf_number.to_i64() {
                // HIDIdleTime is in nanoseconds — convert to milliseconds
                let ms = nanos / 1_000_000;
                return ms.min(u32::MAX as i64) as u32;
            }
        }

        0
    }
}

// ── Linux Input Blocking ──

#[cfg(target_os = "linux")]
mod linux_input {
    use std::sync::Mutex;

    /// Detect whether we're running on Wayland or X11.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum SessionType {
        Wayland,
        X11,
        Unknown,
    }

    pub fn detect_session_type() -> SessionType {
        match std::env::var("XDG_SESSION_TYPE").as_deref() {
            Ok("wayland") => SessionType::Wayland,
            Ok("x11") | Ok("X11") => SessionType::X11,
            _ => {
                // Fallback: check for WAYLAND_DISPLAY
                if std::env::var("WAYLAND_DISPLAY").is_ok() {
                    SessionType::Wayland
                } else if std::env::var("DISPLAY").is_ok() {
                    SessionType::X11
                } else {
                    SessionType::Unknown
                }
            }
        }
    }

    /// Stored X11 connection for ungrab on disengage.
    static X11_CONN: Mutex<Option<x11rb::rust_connection::RustConnection>> = Mutex::new(None);

    /// Install keyboard blocking on Linux.
    pub fn install_keyboard_block() -> Result<isize, String> {
        match detect_session_type() {
            SessionType::X11 => install_keyboard_block_x11(),
            SessionType::Wayland => {
                // Wayland: rely on Tauri's fullscreen overlay grabbing focus.
                // Full ext-session-lock-v1 integration deferred to follow-up.
                eprintln!(
                    "Away Mode: Wayland session — using fullscreen overlay focus for keyboard blocking. \
                     Full ext-session-lock-v1 support planned for future release."
                );
                Ok(1) // sentinel: active via overlay focus
            }
            SessionType::Unknown => {
                eprintln!("Away Mode: Unknown session type — keyboard blocking unavailable.");
                Ok(0)
            }
        }
    }

    fn install_keyboard_block_x11() -> Result<isize, String> {
        use x11rb::connection::Connection;
        use x11rb::protocol::xproto::{ConnectionExt as _, GrabMode};
        use x11rb::CURRENT_TIME;

        let (conn, screen_num) =
            x11rb::connect(None).map_err(|e| format!("X11 connect error: {e}"))?;

        let screen = &conn.setup().roots[screen_num];
        let root = screen.root;

        conn.grab_keyboard(
            true,  // owner_events — report events to our window too
            root,
            CURRENT_TIME,
            GrabMode::ASYNC,
            GrabMode::ASYNC,
        )
        .map_err(|e| format!("XGrabKeyboard request error: {e}"))?
        .reply()
        .map_err(|e| format!("XGrabKeyboard reply error: {e}"))?;

        // Store connection for ungrab
        if let Ok(mut guard) = X11_CONN.lock() {
            *guard = Some(conn);
        }

        Ok(1) // sentinel: active
    }

    /// Remove keyboard blocking on Linux.
    pub fn remove_keyboard_block(_handle: isize) {
        match detect_session_type() {
            SessionType::X11 => remove_keyboard_block_x11(),
            _ => {} // Wayland/Unknown: nothing to clean up
        }
    }

    fn remove_keyboard_block_x11() {
        use x11rb::connection::Connection;
        use x11rb::protocol::xproto::ConnectionExt as _;
        use x11rb::CURRENT_TIME;

        if let Ok(mut guard) = X11_CONN.lock() {
            if let Some(conn) = guard.take() {
                let _ = conn.ungrab_keyboard(CURRENT_TIME);
                let _ = conn.flush();
            }
        }
    }
}

// ── Linux Idle Time Detection ──

#[cfg(target_os = "linux")]
pub fn get_idle_time_ms() -> u32 {
    match linux_input::detect_session_type() {
        linux_input::SessionType::X11 => get_idle_time_ms_x11(),
        _ => {
            // Wayland: no reliable idle detection without ext-idle-notify-v1.
            // Return 0 (never idle) — idle auto-engage won't trigger on Wayland.
            0
        }
    }
}

#[cfg(target_os = "linux")]
fn get_idle_time_ms_x11() -> u32 {
    use x11rb::connection::Connection;
    use x11rb::protocol::screensaver::ConnectionExt as _;

    let (conn, screen_num) = match x11rb::connect(None) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;

    match conn.screensaver_query_info(root) {
        Ok(cookie) => match cookie.reply() {
            Ok(info) => info.ms_since_user_input,
            Err(_) => 0,
        },
        Err(_) => 0,
    }
}

// ── Win32 Helpers (Windows only) ──

#[cfg(target_os = "windows")]
fn apply_exclude_from_capture(hwnd: isize) {
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x00000011;
    extern "system" {
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
    }
    unsafe {
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    }
}

// ── Cross-Platform Keyboard Block Dispatch ──

fn install_keyboard_block() -> Result<isize, String> {
    #[cfg(target_os = "windows")]
    {
        install_keyboard_hook_windows()
    }
    #[cfg(target_os = "macos")]
    {
        macos_input::install_keyboard_block()
    }
    #[cfg(target_os = "linux")]
    {
        linux_input::install_keyboard_block()
    }
}

fn remove_keyboard_block(handle: isize) {
    #[cfg(target_os = "windows")]
    {
        remove_keyboard_hook_windows(handle);
    }
    #[cfg(target_os = "macos")]
    {
        macos_input::remove_keyboard_block(handle);
    }
    #[cfg(target_os = "linux")]
    {
        linux_input::remove_keyboard_block(handle);
    }
}

// ── Low-Level Keyboard Hook (Windows only) ──

#[cfg(target_os = "windows")]
fn install_keyboard_hook_windows() -> Result<isize, String> {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_0, VK_9, VK_BACK, VK_NUMPAD0, VK_NUMPAD9, VK_RETURN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, WH_KEYBOARD_LL,
    };

    unsafe extern "system" fn keyboard_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0 && AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let vk = kb.vkCode as u16;

            let allowed = (vk >= VK_0.0 && vk <= VK_9.0)
                || (vk >= VK_NUMPAD0.0 && vk <= VK_NUMPAD9.0)
                || vk == VK_BACK.0
                || vk == VK_RETURN.0;

            if !allowed {
                return LRESULT(1);
            }
        }
        CallNextHookEx(HHOOK::default(), code, wparam, lparam)
    }

    let hook =
        unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) };
    match hook {
        Ok(h) => Ok(h.0 as isize),
        Err(e) => Err(format!("Failed to install keyboard hook: {e}")),
    }
}

#[cfg(target_os = "windows")]
fn remove_keyboard_hook_windows(hook: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{UnhookWindowsHookEx, HHOOK};
    unsafe {
        let _ = UnhookWindowsHookEx(HHOOK(hook as *mut _));
    }
}

// ── Idle Timeout Monitoring ──

#[cfg(target_os = "windows")]
pub fn get_idle_time_ms() -> u32 {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut lii = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let success = unsafe { GetLastInputInfo(&mut lii) };
    if success.as_bool() {
        extern "system" {
            fn GetTickCount() -> u32;
        }
        let tick_count = unsafe { GetTickCount() };
        tick_count.wrapping_sub(lii.dwTime)
    } else {
        0
    }
}

/// Start idle monitoring — polls every 30s, engages Away Mode on main thread when threshold exceeded.
pub fn start_idle_monitor(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));

        if AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
            continue;
        }

        let cfg = match load_away_config() {
            Ok(c) => c,
            Err(_) => continue,
        };

        if !cfg.enabled || !cfg.idle_timeout_enabled || cfg.pin_hash.is_empty() {
            continue;
        }

        let idle_ms = get_idle_time_ms();
        let threshold_ms = cfg.auto_engage_minutes * 60 * 1000;
        if idle_ms >= threshold_ms {
            let app_caller = app.clone();
            let app_inner = app.clone();
            let _ = app_caller.run_on_main_thread(move || {
                if !AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
                    let _ = create_overlay_window(&app_inner);
                    OVERLAY_ACTIVE.store(true, Ordering::SeqCst);
                    AWAY_MODE_ACTIVE.store(true, Ordering::SeqCst);
                    if let Some(state) = app_inner.try_state::<AwayModeState>() {
                        state.overlay_active.store(true, Ordering::SeqCst);
                        if let Ok(handle) = install_keyboard_block() {
                            if let Ok(mut guard) = state.input_block_handle.lock() {
                                *guard = Some(handle);
                            }
                        }
                    }
                }
            });
        }
    });
}

// ── Watchdog Health Server [F3, F5, F8] ──

/// Start a tiny HTTP server for the Python watchdog to poll.
/// Serves:
/// - GET  /api/away-status      → JSON with away_mode and overlay_active [F8]
/// - POST /api/away-engage      → Engage Away Mode (from phone via Python)
/// - POST /api/away-disengage   → Disengage Away Mode (from phone, no PIN) [F5]
/// - GET  /api/decrypted-keys   → Return decrypted API keys [F3]
pub fn start_health_server(app: AppHandle, state: &AwayModeState, port: u16) {
    if state
        .health_server_running
        .swap(true, Ordering::SeqCst)
    {
        return;
    }

    // Store app handle for engage/disengage routes
    if let Ok(mut guard) = state.app_handle.lock() {
        *guard = Some(app.clone());
    }

    let health_port = port.saturating_add(1); // [F11] safe add
    let app_for_server = app;

    std::thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", health_port);
        let server = match tiny_http::Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Away Mode health server failed to start: {e}");
                return;
            }
        };

        let json_header: tiny_http::Header = "Content-Type: application/json"
            .parse()
            .unwrap();

        for request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().as_str().to_uppercase();

            match (method.as_str(), url.as_str()) {
                ("GET", "/api/away-status") => {
                    // [F8] Read separate atomics for away_mode vs overlay_active
                    let body = serde_json::json!({
                        "away_mode": AWAY_MODE_ACTIVE.load(Ordering::SeqCst),
                        "overlay_active": OVERLAY_ACTIVE.load(Ordering::SeqCst),
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(body)
                        .with_header(json_header.clone());
                    let _ = request.respond(resp);
                }

                ("POST", "/api/away-engage") => {
                    // [F3] Phone-initiated engage via Python server
                    let app_caller = app_for_server.clone();
                    let app_inner = app_for_server.clone();
                    let result = app_caller.run_on_main_thread(move || {
                        if AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
                            return;
                        }
                        let _ = create_overlay_window(&app_inner);
                        OVERLAY_ACTIVE.store(true, Ordering::SeqCst);
                        AWAY_MODE_ACTIVE.store(true, Ordering::SeqCst);
                        if let Some(state) = app_inner.try_state::<AwayModeState>() {
                            state.overlay_active.store(true, Ordering::SeqCst);
                            if let Ok(handle) = install_keyboard_block() {
                                if let Ok(mut guard) = state.input_block_handle.lock() {
                                    *guard = Some(handle);
                                }
                            }
                        }
                    });
                    let body = serde_json::json!({
                        "engaged": result.is_ok(),
                        "away_mode": AWAY_MODE_ACTIVE.load(Ordering::SeqCst),
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(body)
                        .with_header(json_header.clone());
                    let _ = request.respond(resp);
                }

                ("POST", s) if s.starts_with("/api/away-disengage") => {
                    // [F5] Phone-initiated disengage (no PIN required, source=phone)
                    let app_caller = app_for_server.clone();
                    let app_inner = app_for_server.clone();
                    let result = app_caller.run_on_main_thread(move || {
                        if !AWAY_MODE_ACTIVE.load(Ordering::SeqCst) {
                            return;
                        }
                        if let Some(state) = app_inner.try_state::<AwayModeState>() {
                            if let Ok(mut guard) = state.input_block_handle.lock() {
                                if let Some(handle) = guard.take() {
                                    remove_keyboard_block(handle);
                                }
                            }
                            state.overlay_active.store(false, Ordering::SeqCst);
                        }
                        close_overlay_window(&app_inner);
                        OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
                        AWAY_MODE_ACTIVE.store(false, Ordering::SeqCst);
                    });
                    let body = serde_json::json!({
                        "disengaged": result.is_ok(),
                        "away_mode": AWAY_MODE_ACTIVE.load(Ordering::SeqCst),
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(body)
                        .with_header(json_header.clone());
                    let _ = request.respond(resp);
                }

                ("GET", "/api/decrypted-keys") => {
                    // [F3] Return decrypted API keys for Python server
                    let body = match get_decrypted_api_keys() {
                        Ok(v) => v.to_string(),
                        Err(e) => serde_json::json!({"error": e}).to_string(),
                    };
                    let resp = tiny_http::Response::from_string(body)
                        .with_header(json_header.clone());
                    let _ = request.respond(resp);
                }

                _ => {
                    let resp =
                        tiny_http::Response::from_string("Not Found").with_status_code(404);
                    let _ = request.respond(resp);
                }
            }
        }
    });
}

// ── Settings Helpers [F9] ──

fn load_away_config() -> Result<AwayModeConfig, String> {
    let _lock = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = super::settings_path()?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))?;
    let settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON parse error: {e}"))?;

    if let Some(away) = settings.get("away_mode") {
        serde_json::from_value(away.clone())
            .map_err(|e| format!("Away mode config parse error: {e}"))
    } else {
        Ok(AwayModeConfig::default())
    }
}

fn update_away_config(f: impl FnOnce(&mut AwayModeConfig)) -> Result<(), String> {
    let _lock = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = super::settings_path()?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON parse error: {e}"))?;

    let mut cfg = if let Some(away) = settings.get("away_mode") {
        serde_json::from_value(away.clone())
            .map_err(|e| format!("Away mode config parse error: {e}"))?
    } else {
        AwayModeConfig::default()
    };

    f(&mut cfg);

    let obj = settings
        .as_object_mut()
        .ok_or("Settings is not an object")?;
    obj.insert(
        "away_mode".to_string(),
        serde_json::to_value(&cfg).map_err(|e| format!("Serialize error: {e}"))?,
    );

    let pretty =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("Serialize error: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Write error: {e}"))?;
    Ok(())
}
