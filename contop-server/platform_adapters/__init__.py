"""
OS-specific adapters for window management (Windows, macOS, Linux).

Provides get_adapter() which auto-detects the platform and returns
the appropriate PlatformAdapter instance.

[Source: architecture.md — Cross-Platform OS Abstraction Layer]
"""
import platform

from .base import PlatformAdapter


def get_adapter() -> PlatformAdapter:
    """Return the platform adapter for the current OS."""
    system = platform.system()
    if system == "Windows":
        from .windows import WindowsAdapter
        return WindowsAdapter()
    elif system == "Darwin":
        from .macos import MacOSAdapter
        return MacOSAdapter()
    else:
        from .linux import LinuxAdapter
        return LinuxAdapter()


__all__ = ["PlatformAdapter", "get_adapter"]
