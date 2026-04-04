use std::io::{BufRead, BufReader, Read as _};
use std::path::PathBuf;
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

mod away_mode;
mod sidecar;

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Workaround for Tauri bug #14596: set_icon() only reads the first ICO entry,
/// so both title bar and taskbar get the same (wrong-sized) image.
/// We bypass Tauri and call Win32 SendMessageW with correctly-sized HICONs.
/// Uses GetDpiForWindow for pixel-perfect sizes at any DPI scaling.
#[cfg(target_os = "windows")]
mod win_icon {
    use std::os::windows::ffi::OsStrExt;

    const IMAGE_ICON: u32 = 1;
    const LR_LOADFROMFILE: u32 = 0x0000_0010;
    const WM_SETICON: u32 = 0x0080;

    extern "system" {
        fn LoadImageW(hinst: isize, name: *const u16, r#type: u32, cx: i32, cy: i32, flags: u32) -> isize;
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn GetDpiForWindow(hwnd: isize) -> u32;
    }

    /// Write ICO to temp file, use LoadImageW to extract DPI-correct sizes,
    /// then set ICON_SMALL and ICON_BIG independently via SendMessageW.
    pub fn set_icons(hwnd: isize, ico_bytes: &[u8]) {
        let temp = std::env::temp_dir().join("contop-icon.ico");
        if std::fs::write(&temp, ico_bytes).is_err() {
            return;
        }
        let wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            // Get actual DPI for this window's monitor (e.g. 96=100%, 120=125%, 144=150%, 192=200%)
            let dpi = GetDpiForWindow(hwnd);
            let dpi = if dpi == 0 { 96 } else { dpi }; // fallback to 96 if API fails
            let small_size = (16 * dpi / 96) as i32; // 16@100%, 20@125%, 24@150%, 32@200%
            let big_size = (32 * dpi / 96) as i32;   // 32@100%, 40@125%, 48@150%, 64@200%

            let small = LoadImageW(0, wide.as_ptr(), IMAGE_ICON, small_size, small_size, LR_LOADFROMFILE);
            let big = LoadImageW(0, wide.as_ptr(), IMAGE_ICON, big_size, big_size, LR_LOADFROMFILE);

            if small != 0 {
                SendMessageW(hwnd, WM_SETICON, 0, small); // ICON_SMALL
            }
            if big != 0 {
                SendMessageW(hwnd, WM_SETICON, 1, big); // ICON_BIG
            }
        }
        let _ = std::fs::remove_file(&temp);
    }
}

struct ServerState {
    process: Mutex<Option<Child>>,
    port: u16,
}

/// Kill the server subprocess and all its children (process tree).
/// Critical: `uv run uvicorn` spawns uvicorn as a grandchild;
/// killing only the direct child (`uv`) would orphan the uvicorn process.
fn kill_server_process(child: &mut Child) {
    let pid = child.id();

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // taskkill /T kills the entire process tree rooted at PID
        let _ = StdCommand::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    #[cfg(unix)]
    {
        // Send SIGTERM to the process group (negative PID) for graceful shutdown
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        // Follow up with SIGKILL to ensure termination
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }

    // Reap the direct child process with a bounded timeout — never block indefinitely.
    // child.wait() can hang forever on Windows even after taskkill, so we only use try_wait.
    for _ in 0..30 {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(_) => return,
        }
    }
    // Still alive after 3 seconds — force kill and give it one more short window
    let _ = child.kill();
    for _ in 0..10 {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    }
    // Give up — don't block the close sequence
}

/// Find the `uv` binary by checking PATH first, then common install locations.
fn find_uv() -> Result<PathBuf, String> {
    // Try PATH first (works if user has it globally)
    if let Ok(path) = which::which("uv") {
        return Ok(path);
    }
    // Check common install locations with platform-appropriate binary name
    let bin_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".local").join("bin").join(bin_name);
        if candidate.exists() {
            return Ok(candidate);
        }
        // Also check ~/.cargo/bin/uv (alternate install)
        let candidate = home.join(".cargo").join("bin").join(bin_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find 'uv'. Install it (https://docs.astral.sh/uv/) or add it to PATH.".into())
}

/// Resolved paths for the server, adapting to dev vs release mode.
struct ServerPaths {
    uv_path: PathBuf,
    server_dir: PathBuf,
    venv_dir: PathBuf,
}

/// Resolve paths for uv, server directory, and venv location.
///
/// **Release mode:** detected by checking if `resource_dir/contop-server` exists.
///   - uv, server source, and git-bash come from Tauri's bundled resources.
///   - venv lives at `~/.contop/server-venv/` (survives auto-updates).
///
/// **Dev mode:** falls back to compile-time CARGO_MANIFEST_DIR layout.
fn resolve_server_paths(app: &tauri::AppHandle) -> Result<ServerPaths, String> {
    let resource_server = app.path().resource_dir()
        .map_err(|e| format!("Cannot get resource dir: {e}"))?
        .join("contop-server");

    if resource_server.exists() {
        // Release mode
        let resource_dir = app.path().resource_dir()
            .map_err(|e| format!("Cannot get resource dir: {e}"))?;
        let uv_bin = if cfg!(windows) { "uv.exe" } else { "uv" };
        let uv_path = resource_dir.join(uv_bin);
        let server_dir = resource_server;
        let venv_dir = dirs::home_dir()
            .ok_or("Cannot determine home directory")?
            .join(".contop")
            .join("server-venv");
        Ok(ServerPaths { uv_path, server_dir, venv_dir })
    } else {
        // Dev mode — use CARGO_MANIFEST_DIR layout
        let uv_path = find_uv()?;
        let server_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("contop-server")
            .canonicalize()
            .map_err(|e| format!("Cannot find contop-server directory: {e}"))?;
        let venv_dir = server_dir.join(".venv");
        Ok(ServerPaths { uv_path, server_dir, venv_dir })
    }
}

#[tauri::command]
fn start_server(app: tauri::AppHandle, state: State<'_, ServerState>) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    // Clear stale handle if the process already exited (e.g., crash recovery)
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => {
                guard.take();
            }
            Ok(None) => return Err("Server is already running".into()),
        }
    }
    // Guard: fail fast if a stale process already occupies the port
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], state.port));
    if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)).is_ok() {
        return Err(format!(
            "Port {} is already in use by another process. \
             Kill it or set CONTOP_PORT to a different port.",
            state.port
        ));
    }
    let paths = resolve_server_paths(&app)?;

    // Resolve bundled Git Bash path for Python server.
    // In release mode, git-bash is in the resource dir.
    // In dev mode, falls back to system Git Bash.
    #[cfg(target_os = "windows")]
    let bash_path: Option<PathBuf> = {
        let resource_bash = app.path().resource_dir()
            .ok()
            .map(|d| d.join("git-bash").join("bin").join("bash.exe"))
            .filter(|p| p.exists());
        if resource_bash.is_some() {
            resource_bash
        } else {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .map(|d| d.join("resources").join("git-bash").join("bin").join("bash.exe"))
                .filter(|p| p.exists())
        }
    };

    let mut cmd = StdCommand::new(&paths.uv_path);
    cmd.args([
            "run",
            "--no-sync",
            "--extra",
            "omniparser",
            "uvicorn",
            "main:app",
            "--host",
            "0.0.0.0",
            "--port",
            &state.port.to_string(),
        ])
        .current_dir(&paths.server_dir)
        .env("UV_PROJECT_ENVIRONMENT", &paths.venv_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    if let Some(ref bp) = bash_path {
        cmd.env("CONTOP_BASH_PATH", bp.as_os_str());
    }

    // Create a new process group so we can kill the entire tree on shutdown.
    // On Unix: setpgid so we can signal the group with kill(-pgid).
    // On Windows: CREATE_NEW_PROCESS_GROUP prevents the child from receiving
    // Ctrl+C (which would only kill `uv`, orphaning uvicorn). Our RunEvent::Exit
    // handler calls taskkill /T /F to cleanly kill the entire process tree.
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }
    #[cfg(target_os = "windows")]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    let child = cmd.spawn()
        .map_err(|e| format!("Failed to start server: {e}"))?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn run_first_launch_setup(app: tauri::AppHandle) -> Result<String, String> {
    let paths = resolve_server_paths(&app)?;

    // Check setup status — skip if already completed with matching hash
    let contop_dir = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".contop");
    let status_file = contop_dir.join("setup_status.json");
    let pyproject_path = paths.server_dir.join("pyproject.toml");

    let current_hash = std::fs::read(&pyproject_path)
        .map(|bytes| format!("{:x}", md5_hash(&bytes)))
        .unwrap_or_default();

    if status_file.exists() {
        if let Ok(contents) = std::fs::read_to_string(&status_file) {
            if let Ok(status) = serde_json::from_str::<serde_json::Value>(&contents) {
                if status.get("completed").and_then(|v| v.as_bool()) == Some(true)
                    && status.get("pyproject_hash").and_then(|v| v.as_str()) == Some(&current_hash)
                {
                    return Ok("ready".to_string());
                }
            }
        }
    }

    // Run setup_ml.py and stream progress via Tauri events
    let app_clone = app.clone();
    let uv_path = paths.uv_path.to_string_lossy().to_string();
    let server_dir = paths.server_dir.to_string_lossy().to_string();
    let venv_dir = paths.venv_dir.to_string_lossy().to_string();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = StdCommand::new(&uv_path);
        cmd.args([
            "run", "--directory", &server_dir,
            "python", "-m", "tools.setup_ml",
            "--uv-path", &uv_path,
            "--server-dir", &server_dir,
            "--venv-dir", &venv_dir,
        ])
        .env("UV_PROJECT_ENVIRONMENT", &venv_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to start ML setup: {e}"))?;

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_clone.emit("setup-progress", &line);
                }
            }
        }

        let exit = child.wait()
            .map_err(|e| format!("ML setup process error: {e}"))?;

        if exit.success() {
            Ok("success".to_string())
        } else {
            Err("ML setup failed".to_string())
        }
    }).await.map_err(|e| format!("Task join error: {e}"))??;

    // Write status file
    std::fs::create_dir_all(&contop_dir)
        .map_err(|e| format!("Cannot create .contop dir: {e}"))?;

    let status_json = serde_json::json!({
        "completed": result == "success",
        "pyproject_hash": current_hash,
        "completed_at": chrono_now(),
    });
    std::fs::write(&status_file, status_json.to_string())
        .map_err(|e| format!("Cannot write setup status: {e}"))?;

    Ok(result)
}

/// Simple hash for pyproject.toml staleness detection.
fn md5_hash(data: &[u8]) -> u64 {
    // Using a simple FNV-1a hash — no crypto dependency needed for staleness check
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn chrono_now() -> String {
    // Simple ISO 8601 timestamp without chrono crate
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", dur.as_secs())
}

/// Ensure Python dependencies are installed (uv sync).
/// On Windows the NSIS installer runs this at install time, so this is mainly
/// for macOS/Linux (no installer hooks) and as a Windows fallback if the NSIS
/// hook failed. Skips if the venv already has a pyvenv.cfg (deps already installed).
/// Emits "dep-install-progress" events so the frontend can show status.
#[tauri::command]
async fn ensure_dependencies_installed(app: tauri::AppHandle) -> Result<String, String> {
    let paths = resolve_server_paths(&app)?;

    // Skip if venv already exists (deps already installed by NSIS or a prior run)
    let pyvenv_cfg = paths.venv_dir.join("pyvenv.cfg");
    if pyvenv_cfg.exists() {
        return Ok("ready".to_string());
    }

    let app_clone = app.clone();
    let uv_path = paths.uv_path.to_string_lossy().to_string();
    let server_dir = paths.server_dir.to_string_lossy().to_string();
    let venv_dir = paths.venv_dir.to_string_lossy().to_string();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = app_clone.emit("dep-install-progress", "Detecting GPU...");

        // Detect GPU: check for NVIDIA GPU
        let has_nvidia = detect_nvidia_gpu();

        let extras = if has_nvidia {
            let _ = app_clone.emit("dep-install-progress", "NVIDIA GPU detected. Installing with CUDA support (this may take several minutes)...");
            vec!["--extra", "omniparser", "--extra", "cu126"]
        } else {
            let _ = app_clone.emit("dep-install-progress", "No NVIDIA GPU detected. Installing CPU-only dependencies...");
            vec!["--extra", "omniparser", "--extra", "cpu"]
        };

        let mut cmd = StdCommand::new(&uv_path);
        cmd.arg("sync")
            .args(&extras)
            .args(["--directory", &server_dir, "--python-preference", "managed"])
            .env("UV_PROJECT_ENVIRONMENT", &venv_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to start uv sync: {e}"))?;

        // Stream stderr for progress (uv outputs progress to stderr)
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_clone.emit("dep-install-progress", &line);
                }
            }
        }

        let exit = child.wait()
            .map_err(|e| format!("uv sync process error: {e}"))?;

        if exit.success() {
            let _ = app_clone.emit("dep-install-progress", "Dependencies installed successfully.");
            Ok("success".to_string())
        } else {
            Err("Dependency installation failed. The app will retry on next launch.".to_string())
        }
    }).await.map_err(|e| format!("Task join error: {e}"))??;

    Ok(result)
}

/// Detect if an NVIDIA GPU is available by running nvidia-smi.
fn detect_nvidia_gpu() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Use full path — NSIS and installed apps may not have nvidia-smi on PATH
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
        let nvidia_smi = format!("{}\\System32\\nvidia-smi.exe", windir);
        StdCommand::new(&nvidia_smi)
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, try nvidia-smi from PATH
        StdCommand::new("nvidia-smi")
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater()
        .map_err(|e| format!("Updater error: {e}"))?;
    let update = updater.check().await
        .map_err(|e| format!("Update check failed: {e}"))?;
    Ok(update.map(|u| u.version))
}

#[tauri::command]
fn stop_server(state: State<'_, ServerState>) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        kill_server_process(&mut child);
    }
    Ok(())
}

/// Kill whatever process is occupying the configured port.
/// Used to clean up orphaned server processes from prior crashes.
#[tauri::command]
fn kill_port_process(state: State<'_, ServerState>) -> Result<(), String> {
    let port = state.port;

    #[cfg(target_os = "windows")]
    {
        // netstat -ano finds PIDs listening on the port
        let output = StdCommand::new("netstat")
            .args(["-ano"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run netstat: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let port_str = format!(":{}", port);
        for line in stdout.lines() {
            if line.contains(&port_str) && line.contains("LISTENING") {
                if let Some(pid_str) = line.split_whitespace().last() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        if pid > 0 {
                            let _ = StdCommand::new("taskkill")
                                .args(["/T", "/F", "/PID", &pid.to_string()])
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .status();
                        }
                    }
                }
            }
        }
    }

    #[cfg(unix)]
    {
        // Use lsof to find the PID listening on the port
        let output = StdCommand::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for pid_str in stdout.split_whitespace() {
                if let Ok(pid) = pid_str.parse::<i32>() {
                    if pid > 0 {
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_server_port(state: State<'_, ServerState>) -> u16 {
    state.port
}

/// Check if the FastAPI server is healthy by making an HTTP GET from the Rust side.
/// This bypasses Tauri webview network restrictions that block browser fetch().
/// Runs in a blocking task to avoid freezing the Tauri GUI thread.
#[tauri::command]
async fn check_server_health(state: State<'_, ServerState>) -> Result<bool, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}/health", port);
        Ok(matches!(
            ureq::AgentBuilder::new()
                .timeout_connect(std::time::Duration::from_secs(2))
                .timeout_read(std::time::Duration::from_secs(2))
                .build()
                .get(&url)
                .call(),
            Ok(resp) if resp.status() == 200
        ))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// --- Settings persistence (Story 1.9) ---

const DEFAULT_SETTINGS_JSON: &str = r#"{
  "version": 1,
  "gemini_api_key": "",
  "openai_api_key": "",
  "anthropic_api_key": "",
  "openrouter_api_key": "",
  "conversation_system_prompt": "",
  "execution_system_prompt": "",
  "restricted_paths": [
    "/root",
    "/etc/shadow",
    "/etc/passwd",
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\SysWOW64"
  ],
  "forbidden_commands": [
    "rm -rf /",
    "mkfs",
    "dd if=",
    "format C:",
    "del /f /s /q C:\\"
  ],
  "keep_host_awake": false,
  "destructive_patterns": [
    "rm", "rmdir", "del", "deltree", "rd", "erase",
    "mv",
    "kill", "killall", "pkill", "taskkill",
    "shutdown", "halt", "reboot", "poweroff",
    "format", "mkfs", "fdisk", "dd",
    "DROP TABLE", "DROP DATABASE", "TRUNCATE",
    "remove-item", "move-item", "stop-process",
    "restart-computer", "stop-computer", "clear-content", "clear-item"
  ]
}"#;

/// Resolve ~/.contop/settings.json path.
fn settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".contop").join("settings.json"))
}

/// Ensure ~/.contop/ directory exists and create default settings if file is missing.
fn ensure_settings_file() -> Result<(), String> {
    let path = settings_path()?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {e}"))?;
        }
        std::fs::write(&path, DEFAULT_SETTINGS_JSON)
            .map_err(|e| format!("Failed to write default settings: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn load_settings() -> Result<serde_json::Value, String> {
    let path = settings_path()?;
    if !path.exists() {
        ensure_settings_file()?;
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {e}"))?;
    let val: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => {
            // Corrupted — overwrite with defaults and return them (AC4: silent recovery)
            std::fs::write(&path, DEFAULT_SETTINGS_JSON)
                .map_err(|e| format!("Failed to restore defaults: {e}"))?;
            return serde_json::from_str(DEFAULT_SETTINGS_JSON)
                .map_err(|e| format!("Default settings parse error: {e}"));
        }
    };
    // Validate required keys
    if val.get("version").is_none()
        || val.get("restricted_paths").is_none()
        || val.get("forbidden_commands").is_none()
    {
        std::fs::write(&path, DEFAULT_SETTINGS_JSON)
            .map_err(|e| format!("Failed to restore defaults: {e}"))?;
        return serde_json::from_str(DEFAULT_SETTINGS_JSON)
            .map_err(|e| format!("Default settings parse error: {e}"));
    }
    Ok(val)
}

#[tauri::command]
fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    match (
        settings.get("version"),
        settings.get("restricted_paths"),
        settings.get("forbidden_commands"),
    ) {
        (Some(v), Some(rp), Some(fc))
            if v.is_number() && rp.is_array() && fc.is_array() => {}
        _ => {
            return Err(
                "Settings must contain keys: version (number), restricted_paths (array), forbidden_commands (array)".into(),
            );
        }
    }
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {e}"))?;
    }
    let pretty = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    std::fs::write(&path, pretty)
        .map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}

#[tauri::command]
fn reset_settings() -> Result<serde_json::Value, String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {e}"))?;
    }
    std::fs::write(&path, DEFAULT_SETTINGS_JSON)
        .map_err(|e| format!("Failed to write default settings: {e}"))?;
    serde_json::from_str(DEFAULT_SETTINGS_JSON)
        .map_err(|e| format!("Default settings parse error: {e}"))
}

/// Fetch the QR code PNG from the server via Rust-side HTTP POST.
/// Returns raw PNG bytes that the frontend converts to a blob URL.
/// Accepts optional connection_type ("permanent" or "temp") for temp QR generation.
/// Runs in a blocking task to avoid freezing the Tauri GUI thread.
#[tauri::command]
async fn fetch_qr_code(state: State<'_, ServerState>, connection_type: Option<String>) -> Result<Vec<u8>, String> {
    let port = state.port;
    let conn_type = connection_type.unwrap_or_else(|| "permanent".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}/api/pair?connection_type={}", port, conn_type);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(10))
            .build();
        match agent.post(&url).call() {
            Ok(resp) => {
                let mut bytes = Vec::new();
                // Limit to 5 MB (QR PNGs are ~few KB)
                resp.into_reader()
                    .take(5_242_880)
                    .read_to_end(&mut bytes)
                    .map_err(|e| format!("Failed to read QR data: {e}"))?;
                Ok(bytes)
            }
            Err(ureq::Error::Status(_code, resp)) => {
                let mut body = String::new();
                let _ = resp.into_reader().take(65_536).read_to_string(&mut body);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
                        return Err(msg.to_string());
                    }
                }
                Err(body)
            }
            Err(e) => Err(format!("QR fetch failed: {e}")),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Forget the current paired connection by revoking the token on the server
/// AND deleting the persisted tokens file so the server can't reload it.
/// Best-effort: succeeds even if the server is unreachable (connection is
/// considered forgotten locally regardless).
#[tauri::command]
async fn forget_connection(state: State<'_, ServerState>) -> Result<(), String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        // 1. Try server-side revocation (may fail if server is down)
        let url = format!("http://127.0.0.1:{}/api/pair", port);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(3))
            .timeout_read(std::time::Duration::from_secs(3))
            .build();
        if let Err(e) = agent.delete(&url).call() {
            eprintln!("Best-effort token revocation failed (server may be down): {e}");
        }

        // 2. Always delete the tokens file so the server can't reload the old
        //    token on next start — this is the reliable fallback when the
        //    server-side DELETE fails (e.g. server is off).
        if let Some(home) = dirs::home_dir() {
            let tokens_path = home.join(".contop").join("tokens.json");
            if tokens_path.exists() {
                if let Err(e) = std::fs::remove_file(&tokens_path) {
                    eprintln!("Failed to delete tokens file: {e}");
                }
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Start the Cloudflare tunnel on demand (for temp QR generation).
#[tauri::command]
async fn start_tunnel(state: State<'_, ServerState>) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}/api/tunnel/start", port);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(60))
            .build();
        match agent.post(&url).call() {
            Ok(resp) => {
                let mut body = String::new();
                resp.into_reader()
                    .take(1_048_576)
                    .read_to_string(&mut body)
                    .map_err(|e| format!("Failed to read tunnel response: {e}"))?;
                let json: serde_json::Value =
                    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))?;
                Ok(json)
            }
            Err(ureq::Error::Status(_code, resp)) => {
                let mut body = String::new();
                let _ = resp.into_reader().take(65_536).read_to_string(&mut body);
                Err(format!("Tunnel start failed: {body}"))
            }
            Err(e) => Err(format!("Tunnel start failed: {e}")),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Fetch pairing status from the server API.
#[tauri::command]
async fn fetch_pairing_status(state: State<'_, ServerState>) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}/api/pair/status", port);
        let resp = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build()
            .get(&url)
            .call()
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut body)
            .map_err(|e| format!("Failed to read pairing status: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Fetch connection info from the server API for the desktop GUI.
/// Returns JSON with LAN IP, Tailscale status, tunnel status, and client count.
/// Runs as async to avoid blocking the Tauri main/GUI thread (F2 fix).
#[tauri::command]
async fn fetch_connection_info(state: State<'_, ServerState>) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}/api/connection-info", port);
        let resp = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build()
            .get(&url)
            .call()
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        // Limit read to 1 MB to prevent unbounded memory allocation (F3 fix)
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut body)
            .map_err(|e| format!("Failed to read connection info: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Generic GET proxy — forwards any path to the local FastAPI server.
/// Used by pages (e.g. Skills) that need simple REST calls without dedicated commands.
#[tauri::command]
async fn proxy_get(state: State<'_, ServerState>, path: String) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}{}", port, path);
        let resp = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build()
            .get(&url)
            .call()
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut body)
            .map_err(|e| format!("Failed to read response: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Generic POST proxy — forwards any path to the local FastAPI server.
/// Accepts an optional JSON body for POST requests that need one.
#[tauri::command]
async fn proxy_post(state: State<'_, ServerState>, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}{}", port, path);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build();
        let req = agent.post(&url);
        let resp = if let Some(json_body) = body {
            let json_str = serde_json::to_string(&json_body).map_err(|e| format!("JSON serialize error: {e}"))?;
            req.set("Content-Type", "application/json")
               .send_string(&json_str)
               .map_err(|e| e.to_string())?
        } else {
            req.call().map_err(|e| e.to_string())?
        };
        let mut resp_body = String::new();
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut resp_body)
            .map_err(|e| format!("Failed to read response: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&resp_body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Generic DELETE proxy — forwards any path to the local FastAPI server.
#[tauri::command]
async fn proxy_delete(state: State<'_, ServerState>, path: String) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}{}", port, path);
        let resp = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build()
            .delete(&url)
            .call()
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut body)
            .map_err(|e| format!("Failed to read response: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Generic PUT proxy — forwards path + JSON body to the local FastAPI server.
#[tauri::command]
async fn proxy_put(state: State<'_, ServerState>, path: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}{}", port, path);
        let json_str = serde_json::to_string(&body).map_err(|e| format!("JSON serialize error: {e}"))?;
        let resp = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build()
            .put(&url)
            .set("Content-Type", "application/json")
            .send_string(&json_str)
            .map_err(|e| e.to_string())?;
        let mut resp_body = String::new();
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut resp_body)
            .map_err(|e| format!("Failed to read response: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&resp_body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Fetch default system prompts from the server API.
/// Used by the desktop Prompts page to show/edit prompts.
#[tauri::command]
async fn fetch_default_prompts(state: State<'_, ServerState>) -> Result<serde_json::Value, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("http://127.0.0.1:{}/api/default-prompts", port);
        let resp = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build()
            .get(&url)
            .call()
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        resp.into_reader()
            .take(1_048_576)
            .read_to_string(&mut body)
            .map_err(|e| format!("Failed to read default prompts: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))?;
        Ok(json)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set Windows AUMID so notifications show "Contop Desktop" instead of
    // inheriting the terminal's identity (e.g. "Windows PowerShell") in dev mode.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(appid: *const u16) -> i32;
        }
        let id: Vec<u16> = std::ffi::OsStr::new("com.mmssw.contop-desktop")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()); }
    }

    let port: u16 = std::env::var("CONTOP_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8000);

    // Ensure settings file exists on startup (Story 1.9, Task 5.6)
    if let Err(e) = ensure_settings_file() {
        eprintln!("Warning: failed to initialize settings: {e}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerState {
            process: Mutex::new(None),
            port,
        })
        .manage(away_mode::AwayModeState::default())
        .manage(sidecar::ProxyRegistry::new())
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
            run_first_launch_setup,
            ensure_dependencies_installed,
            check_for_updates,
            kill_port_process,
            get_server_port,
            check_server_health,
            fetch_qr_code,
            fetch_connection_info,
            fetch_pairing_status,
            forget_connection,
            start_tunnel,
            load_settings,
            save_settings,
            reset_settings,
            fetch_default_prompts,
            proxy_get,
            proxy_post,
            proxy_put,
            proxy_delete,
            away_mode::set_away_pin,
            away_mode::verify_away_pin,
            away_mode::set_emergency_pin,
            away_mode::has_away_pin,
            away_mode::get_away_mode_config,
            away_mode::update_away_mode_settings,
            away_mode::engage_away_mode,
            away_mode::disengage_away_mode,
            away_mode::get_away_mode_status,
            away_mode::encrypt_dpapi,
            away_mode::decrypt_dpapi,
            away_mode::get_decrypted_api_keys,
            away_mode::migrate_keys_to_plaintext,
            sidecar::start_proxy,
            sidecar::stop_proxy,
            sidecar::proxy_status
        ])
        .setup(move |app| {
            let main_window = app.get_webview_window("main")
                .expect("failed to get main window");
            #[cfg(target_os = "windows")]
            {
                let hwnd = main_window.hwnd().expect("failed to get hwnd");
                win_icon::set_icons(hwnd.0 as isize, include_bytes!("../icons/icon.ico"));
            }
            #[cfg(not(target_os = "windows"))]
            {
                let icon = tauri::image::Image::from_bytes(
                    include_bytes!("../icons/128x128@2x.png"),
                )
                .expect("failed to load icon");
                main_window.set_icon(icon)?;
            }

            // Reverse-migrate any keyring/DPAPI markers back to plaintext on startup
            if let Err(e) = away_mode::migrate_keys_to_plaintext() {
                eprintln!("Warning: key migration to plaintext failed: {e}");
            }

            // Start Away Mode health server for Python watchdog
            let away_state = app.state::<away_mode::AwayModeState>();
            away_mode::start_health_server(app.handle().clone(), &away_state, port);

            // Start idle timeout monitor
            away_mode::start_idle_monitor(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } => {
                    // Spawn cleanup on a background thread so the event loop stays
                    // responsive. Blocking here (e.g. sleeping in try_wait loops)
                    // freezes the event loop and prevents the window from closing.
                    let app = app_handle.clone();
                    std::thread::spawn(move || {
                        let state = app.state::<ServerState>();
                        if let Ok(mut guard) = state.process.try_lock() {
                            if let Some(mut child) = guard.take() {
                                kill_server_process(&mut child);
                            }
                        }
                        sidecar::shutdown_all(&app.state::<sidecar::ProxyRegistry>());
                    });
                }
                tauri::RunEvent::Exit => {
                    // Final synchronous cleanup — runs after the event loop stops,
                    // so blocking here is acceptable. Catches anything the background
                    // thread from ExitRequested hasn't finished yet.
                    let state = app_handle.state::<ServerState>();
                    if let Ok(mut guard) = state.process.try_lock() {
                        if let Some(mut child) = guard.take() {
                            kill_server_process(&mut child);
                        }
                    }
                    sidecar::shutdown_all(&app_handle.state::<sidecar::ProxyRegistry>());
                }
                _ => {}
            }
        });
}
