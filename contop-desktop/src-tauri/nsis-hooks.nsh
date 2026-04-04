; Post-install hook: run uv sync to install Python dependencies (including PyTorch)
; This runs inside the NSIS installer after all files are copied.

!include "x64.nsh"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing Python dependencies (this may take several minutes)..."

  ; Set venv location to ~/.contop/server-venv (survives app updates)
  System::Call 'kernel32::SetEnvironmentVariable(t "UV_PROJECT_ENVIRONMENT", t "$PROFILE\.contop\server-venv")i'

  ; Detect NVIDIA GPU — disable WoW64 filesystem redirection first because
  ; NSIS is 32-bit and System32 silently redirects to SysWOW64 otherwise.
  ${DisableX64FSRedirection}
  ${If} ${FileExists} "$WINDIR\System32\nvidia-smi.exe"
    ; NVIDIA GPU found — install with CUDA support
    DetailPrint "NVIDIA GPU detected. Installing with CUDA support..."
    DetailPrint "Downloading PyTorch with CUDA (~2.5 GB). Please wait..."
    nsExec::ExecToLog '"$INSTDIR\resources\uv.exe" sync --extra omniparser --extra cu126 --directory "$INSTDIR\resources\contop-server" --python-preference managed'
  ${Else}
    ; No NVIDIA GPU — install CPU-only
    DetailPrint "No NVIDIA GPU detected. Installing CPU-only dependencies..."
    nsExec::ExecToLog '"$INSTDIR\resources\uv.exe" sync --extra omniparser --extra cpu --directory "$INSTDIR\resources\contop-server" --python-preference managed'
  ${EndIf}
  ${EnableX64FSRedirection}

  Pop $0 ; uv sync exit code
  ${If} $0 == 0
    DetailPrint "Dependencies installed successfully."
  ${Else}
    DetailPrint "Warning: Dependency installation had issues (exit code: $0). The app will retry on first launch."
  ${EndIf}
!macroend
