/// CLI proxy sidecar management — starts/stops/monitors contop-cli-proxy processes.
///
/// Each provider (claude, gemini, codex) runs as a separate Node.js subprocess
/// listening on a fixed localhost port:
///   claude → 3456,  gemini → 3457,  codex → 3458
///
/// The ProxyRegistry holds a Mutex over the map so Tauri commands can safely
/// interact with subprocesses from any thread.
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Read as _;
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct ProxyRegistry {
    pub processes: Mutex<HashMap<String, Child>>,
}

impl ProxyRegistry {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

/// Map provider name to its default port.
/// Accepts both the sidecar key ("claude", "codex") and the auth key
/// ("anthropic", "openai") used by the frontend settings.
fn default_port(provider: &str) -> Option<u16> {
    match provider {
        "claude" | "anthropic" => Some(3456),
        "gemini" => Some(3457),
        "codex" | "openai" => Some(3458),
        _ => None,
    }
}

/// Build a PATH that includes common locations for npm-installed CLI binaries.
/// GUI apps often inherit a minimal PATH that is missing user-installed tools.
fn resolve_cli_path() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut path = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();

    // Collect candidate directories where npm global binaries may live.
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // npm global bin: %APPDATA%\npm  (may be literal in PATH from Git Bash)
        if let Ok(appdata) = std::env::var("APPDATA") {
            path = path.replace("%APPDATA%\\npm", &format!("{}\\npm", appdata));
            candidates.push(std::path::PathBuf::from(appdata).join("npm"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Homebrew (Apple Silicon + Intel)
        candidates.push(std::path::PathBuf::from("/opt/homebrew/bin"));
        candidates.push(std::path::PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(std::path::PathBuf::from("/usr/local/bin"));
        candidates.push(home.join(".local").join("bin"));
    }

    // nvm — resolve the active node version's bin directory
    #[cfg(unix)]
    {
        let nvm_dir = std::env::var("NVM_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| home.join(".nvm"));
        // nvm creates a "current" symlink pointing to the active version
        let nvm_current = nvm_dir.join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(&nvm_current) {
            // Pick the newest version directory (reverse-sorted, first entry)
            let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            if let Some(latest) = versions.first() {
                candidates.push(latest.path().join("bin"));
            }
        }
        // Also check the "current" alias symlink
        let current_bin = nvm_dir.join("current").join("bin");
        candidates.push(current_bin);
    }

    // npm custom global prefix (works cross-platform)
    candidates.push(home.join(".npm-global").join("bin"));

    // Append any existing candidate dirs that aren't already in PATH
    for dir in candidates {
        if dir.exists() {
            let dir_str = dir.to_string_lossy().to_string();
            let already = path.split(sep).any(|p| {
                if cfg!(windows) { p.eq_ignore_ascii_case(&dir_str) } else { p == dir_str }
            });
            if !already {
                path = format!("{}{}{}", dir_str, sep, path);
            }
        }
    }

    path
}

/// Kill a proxy process and all its children (process tree).
fn kill_proxy(child: &mut Child) {
    let pid = child.id();

    #[cfg(target_os = "windows")]
    {
        let _ = StdCommand::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    #[cfg(unix)]
    {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }

    // Bounded wait — never block indefinitely (child.wait() can hang on Windows)
    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
        }
    }
    let _ = child.kill();
}

/// Start a contop-cli-proxy process for the given provider.
/// In release mode, runs the bundled dist/index.js from resources.
/// In dev mode, auto-builds from the source tree.
#[tauri::command]
pub fn start_proxy(
    app: tauri::AppHandle,
    provider: String,
    port: Option<u16>,
    registry: tauri::State<'_, ProxyRegistry>,
) -> Result<(), String> {
    let port = port
        .or_else(|| default_port(&provider))
        .ok_or_else(|| format!("Unknown provider '{}' and no port provided", provider))?;

    let mut processes = registry
        .processes
        .lock()
        .map_err(|e| e.to_string())?;

    // Check if already running (and hasn't exited)
    if let Some(child) = processes.get_mut(&provider) {
        match child.try_wait() {
            Ok(None) => {
                // Process handle is alive — but is it actually serving?
                let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
                let port_in_use = std::net::TcpStream::connect_timeout(
                    &addr, std::time::Duration::from_millis(300),
                ).is_ok();
                if port_in_use {
                    return Err(format!("{} proxy is already running", provider));
                }
                // Process alive but not serving — kill the zombie and start fresh
                if let Some(mut stale) = processes.remove(&provider) {
                    kill_proxy(&mut stale);
                }
            }
            _ => {
                // Process exited — remove stale handle
                processes.remove(&provider);
            }
        }
    }

    // Guard: fail if port is already in use by an external process
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)).is_ok() {
        return Err(format!(
            "Port {} is already occupied by another process",
            port
        ));
    }

    // Find contop-cli-proxy: check bundled resources first, then source tree (dev).
    use tauri::Manager;
    let proxy_dir = {
        // Release: <resource_dir>/resources/contop-cli-proxy or <exe_dir>/resources/contop-cli-proxy
        let candidates: Vec<std::path::PathBuf> = [
            app.path().resource_dir().ok(),
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf())),
        ]
        .into_iter()
        .flatten()
        .collect();

        let release_dir = candidates.iter()
            .map(|d| d.join("resources").join("contop-cli-proxy"))
            .find(|d| d.join("dist").join("index.js").exists());

        if let Some(dir) = release_dir {
            dir
        } else {
            // Dev mode: resolve from source tree and auto-build
            let raw = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..").join("..").join("contop-cli-proxy")
                .canonicalize()
                .map_err(|e| format!("Cannot find contop-cli-proxy directory: {e}"))?;
            let s = raw.to_string_lossy();
            let proxy_dir = std::path::PathBuf::from(
                s.strip_prefix(r"\\?\").unwrap_or(&s)
            );

            // Auto-build if src/ is newer than dist/
            let dist_script = proxy_dir.join("dist").join("index.js");
            let src_dir = proxy_dir.join("src");
            let needs_build = if dist_script.exists() {
                let dist_mtime = std::fs::metadata(&dist_script)
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                std::fs::read_dir(&src_dir)
                    .map(|entries| {
                        entries.filter_map(|e| e.ok()).any(|e| {
                            e.path().extension().map_or(false, |ext| ext == "ts")
                                && e.metadata()
                                    .and_then(|m| m.modified())
                                    .map_or(false, |t| t > dist_mtime)
                        })
                    })
                    .unwrap_or(true)
            } else {
                true
            };

            if needs_build && src_dir.exists() {
                let npm_cmd = if cfg!(target_os = "windows") { "npm.cmd" } else { "npm" };
                let mut build_cmd = StdCommand::new(npm_cmd);
                build_cmd
                    .args(["run", "build"])
                    .current_dir(&proxy_dir)
                    .stdout(Stdio::null())
                    .stderr(Stdio::piped());
                #[cfg(target_os = "windows")]
                build_cmd.creation_flags(CREATE_NO_WINDOW);
                match build_cmd.status() {
                    Ok(s) if s.success() => {}
                    Ok(s) => return Err(format!(
                        "contop-cli-proxy build failed (exit {})",
                        s.code().unwrap_or(-1)
                    )),
                    Err(e) => return Err(format!("Failed to run npm build for contop-cli-proxy: {e}")),
                }
            }
            proxy_dir
        }
    };

    let dist_script = proxy_dir.join("dist").join("index.js");
    if !dist_script.exists() {
        return Err(format!(
            "contop-cli-proxy not found at {}",
            dist_script.display()
        ));
    }
    // Strip \\?\ prefix — Node.js on Windows cannot resolve extended-length paths
    let dist_script_str = dist_script.to_string_lossy().to_string();
    let dist_script_clean = dist_script_str.strip_prefix(r"\\?\").unwrap_or(&dist_script_str).to_string();

    let port_str = port.to_string();
    let (cmd, args): (&str, Vec<&str>) = (
        "node",
        vec![&dist_script_clean, "--provider", &provider, "--port", &port_str],
    );

    // Log proxy output to ~/.contop/proxy-{provider}.log
    let log_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".contop");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join(format!("proxy-{}.log", provider));
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    let (stdout_stdio, stderr_stdio) = match log_file {
        Some(f) => {
            let f2 = f.try_clone().unwrap_or_else(|_| {
                OpenOptions::new().append(true).open(&log_path).unwrap()
            });
            (Stdio::from(f), Stdio::from(f2))
        }
        None => (Stdio::null(), Stdio::null()),
    };

    // Ensure CLI binaries (claude, gemini, codex) are discoverable by the child
    // process. GUI apps often inherit a minimal PATH that is missing user-installed
    // tools:
    //   Windows — %APPDATA%\npm stays unexpanded when launched from Git Bash
    //   macOS   — Finder/Spotlight give only /usr/bin:/bin, missing Homebrew & nvm
    //   Linux   — desktop launchers skip .bashrc/.profile
    let resolved_path = resolve_cli_path();

    let mut child_cmd = StdCommand::new(cmd);
    child_cmd
        .args(&args)
        .env("PATH", &resolved_path)
        .stdout(stdout_stdio)
        .stderr(stderr_stdio);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        child_cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt as _;
        child_cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }
    let child = child_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn contop-cli-proxy for '{}': {}", provider, e))?;

    processes.insert(provider, child);
    Ok(())
}

/// Stop the proxy for the given provider.
#[tauri::command]
pub fn stop_proxy(
    provider: String,
    registry: tauri::State<'_, ProxyRegistry>,
) -> Result<(), String> {
    let mut processes = registry
        .processes
        .lock()
        .map_err(|e| e.to_string())?;

    match processes.remove(&provider) {
        Some(mut child) => {
            kill_proxy(&mut child);
            Ok(())
        }
        None => Err(format!("No proxy running for provider '{}'", provider)),
    }
}

/// Return status of the proxy for the given provider.
///
/// Status values:
///   "running"  — process alive AND /health reports session_active: true
///   "degraded" — process alive but session not active (CLI binary missing, auth failure, etc.)
///   "starting" — process alive but HTTP server not ready yet
///   "stopped"  — process not running
#[tauri::command]
pub fn proxy_status(
    provider: String,
    registry: tauri::State<'_, ProxyRegistry>,
) -> Result<serde_json::Value, String> {
    let port = default_port(&provider);

    let process_alive = {
        let mut processes = registry
            .processes
            .lock()
            .map_err(|e| e.to_string())?;

        match processes.get_mut(&provider) {
            None => false,
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) | Err(_) => {
                    // Process exited — clean up stale handle
                    processes.remove(&provider);
                    false
                }
            },
        }
    };

    if !process_alive {
        return Ok(serde_json::json!({
            "provider": provider,
            "status": "stopped",
            "port": port,
        }));
    }

    // Process is alive — verify via HTTP health check that the session is active.
    let status = if let Some(p) = port {
        let url = format!("http://127.0.0.1:{}/health", p);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_millis(500))
            .timeout_read(std::time::Duration::from_millis(500))
            .build();
        match agent.get(&url).call() {
            Ok(resp) => {
                let mut body = String::new();
                if resp.into_reader().take(8192).read_to_string(&mut body).is_ok() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if json.get("session_active").and_then(|v| v.as_bool()) == Some(true) {
                            "running"
                        } else {
                            "degraded"
                        }
                    } else {
                        "degraded"
                    }
                } else {
                    "degraded"
                }
            }
            Err(_) => "starting", // process alive but HTTP not ready yet
        }
    } else {
        "running" // no port known — fall back to process-alive check
    };

    Ok(serde_json::json!({
        "provider": provider,
        "status": status,
        "port": port,
    }))
}

/// Shut down all running proxy processes. Call this from RunEvent::Exit.
pub fn shutdown_all(registry: &ProxyRegistry) {
    if let Ok(mut processes) = registry.processes.try_lock() {
        for (_, mut child) in processes.drain() {
            kill_proxy(&mut child);
        }
    }
}
