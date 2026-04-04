"""GPU detection and ML stack installation via uv.

Standalone module — no torch/ML imports at module level (must run before torch exists).
All installation goes through `uv sync` with the correct extras.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable


def detect_gpu() -> dict:
    """Detect GPU type and capabilities.

    Returns dict with keys: type, cuda_version, device_name.
    Never raises — returns {"type": "cpu"} if detection fails.
    """
    # macOS Apple Silicon
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return {"type": "apple_silicon", "cuda_version": None, "device_name": "Apple Silicon (MPS)"}

    # Try nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return {"type": "cpu", "cuda_version": None, "device_name": "CPU"}

        device_name, driver_version = result.stdout.strip().split(",", 1)
        device_name = device_name.strip()
        driver_version = driver_version.strip()

        # Parse CUDA version from nvidia-smi header
        header = subprocess.run(
            ["nvidia-smi"],
            capture_output=True, text=True, timeout=10,
        )
        cuda_version = None
        if header.returncode == 0:
            match = re.search(r"CUDA Version:\s*([\d.]+)", header.stdout)
            if match:
                cuda_version = match.group(1)

        # Check driver is new enough for cu126 (requires >= 528.33)
        try:
            major = int(driver_version.split(".")[0])
            if major < 528:
                return {"type": "cpu", "cuda_version": cuda_version, "device_name": f"{device_name} (driver too old)"}
        except (ValueError, IndexError):
            pass

        return {"type": "nvidia", "cuda_version": cuda_version, "device_name": device_name}

    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"type": "cpu", "cuda_version": None, "device_name": "CPU"}


def check_torch_status() -> dict:
    """Check current torch installation status.

    Returns dict with keys: installed, version, cuda_available, cuda_version, needs_upgrade.
    """
    try:
        import importlib
        torch = importlib.import_module("torch")
        cuda_available = torch.cuda.is_available()
        cuda_version = torch.version.cuda if hasattr(torch.version, "cuda") else None

        gpu_info = detect_gpu()
        needs_upgrade = gpu_info["type"] == "nvidia" and not cuda_available

        return {
            "installed": True,
            "version": torch.__version__,
            "cuda_available": cuda_available,
            "cuda_version": cuda_version,
            "needs_upgrade": needs_upgrade,
        }
    except ImportError:
        return {
            "installed": False,
            "version": None,
            "cuda_available": False,
            "cuda_version": None,
            "needs_upgrade": False,
        }


def get_uv_extra_for_gpu(gpu_info: dict) -> str:
    """Return the uv extra name for the detected GPU type."""
    if gpu_info["type"] == "nvidia":
        return "cu126"
    elif gpu_info["type"] == "apple_silicon":
        return ""  # default PyPI, includes MPS
    else:
        return "cpu"


def ensure_ml_stack(
    uv_path: str,
    server_dir: str,
    venv_dir: str,
    on_progress: Callable[[str, str], None],
) -> dict:
    """Orchestrate GPU detection and ML stack installation.

    Args:
        uv_path: Path to the uv binary.
        server_dir: Path to the contop-server directory.
        venv_dir: Path for the virtual environment.
        on_progress: Callback(stage, message) for progress updates.

    Returns dict with keys: status, gpu_type, torch_version, gpu_enabled, message.
    """
    on_progress("detect_gpu", "Detecting GPU...")
    gpu_info = detect_gpu()
    on_progress("detect_gpu", f"Detected: {gpu_info['device_name']}")

    on_progress("check_torch", "Checking current installation...")
    torch_status = check_torch_status()

    gpu_extra = get_uv_extra_for_gpu(gpu_info)

    # Skip if already correct
    if torch_status["installed"] and not torch_status["needs_upgrade"]:
        on_progress("skip", "ML stack already installed and configured correctly.")
        return {
            "status": "success",
            "gpu_type": gpu_info["type"],
            "torch_version": torch_status["version"],
            "gpu_enabled": torch_status["cuda_available"],
            "message": "Already up to date",
        }

    # Build uv sync command
    cmd = [
        uv_path, "sync",
        "--extra", "omniparser",
        "--directory", server_dir,
        "--python-preference", "managed",
    ]
    if gpu_extra:
        cmd.extend(["--extra", gpu_extra])

    env_vars = {"UV_PROJECT_ENVIRONMENT": venv_dir}

    gpu_label = {
        "nvidia": "CUDA support",
        "apple_silicon": "MPS support",
        "cpu": "CPU only",
    }.get(gpu_info["type"], "")

    on_progress("uv_sync", f"Installing dependencies with {gpu_label} (this may take several minutes)...")

    try:
        import os
        env = {**os.environ, **env_vars}
        result = subprocess.run(
            cmd,
            capture_output=True, text=True,
            timeout=1800,  # 30 min for large PyTorch downloads
            env=env,
        )

        if result.returncode != 0:
            on_progress("error", f"uv sync failed: {result.stderr[:500]}")
            return {
                "status": "error",
                "gpu_type": gpu_info["type"],
                "torch_version": None,
                "gpu_enabled": False,
                "message": f"uv sync failed: {result.stderr[:500]}",
            }

        # Re-check torch after install
        final_status = check_torch_status()
        on_progress("done", "ML stack installed successfully.")

        return {
            "status": "success",
            "gpu_type": gpu_info["type"],
            "torch_version": final_status.get("version"),
            "gpu_enabled": final_status.get("cuda_available", False),
            "message": "Installed successfully",
        }

    except subprocess.TimeoutExpired:
        on_progress("error", "Installation timed out after 30 minutes.")
        return {
            "status": "error",
            "gpu_type": gpu_info["type"],
            "torch_version": None,
            "gpu_enabled": False,
            "message": "Installation timed out",
        }


def compute_pyproject_hash(server_dir: str) -> str:
    """Compute SHA-256 hash of pyproject.toml for staleness detection."""
    pyproject_path = Path(server_dir) / "pyproject.toml"
    return hashlib.sha256(pyproject_path.read_bytes()).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GPU detection and ML stack setup")
    parser.add_argument("--uv-path", required=True, help="Path to uv binary")
    parser.add_argument("--server-dir", required=True, help="Path to contop-server")
    parser.add_argument("--venv-dir", required=True, help="Path for virtual environment")
    args = parser.parse_args()

    def json_progress(stage: str, message: str) -> None:
        print(json.dumps({"stage": stage, "message": message}), flush=True)

    result = ensure_ml_stack(args.uv_path, args.server_dir, args.venv_dir, json_progress)
    print(json.dumps({"stage": "result", **result}), flush=True)
    sys.exit(0 if result["status"] == "success" else 1)
