[CmdletBinding()]
param(
    [string]$PythonPath = "",
    [string]$VenvPath = "",
    [switch]$PlanOnly
)

$ErrorActionPreference = "Stop"
$sidecarDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$requirements = Join-Path $sidecarDir "requirements.txt"
if (-not $VenvPath) {
    $VenvPath = Join-Path $env:LOCALAPPDATA "com.gmaiden.ann-studio\sidecar-python"
}

function Find-Python {
    if ($env:PYTHON_PATH -and (Test-Path -LiteralPath $env:PYTHON_PATH -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $env:PYTHON_PATH).Path
    }
    if ($env:AI_STUDIO_TOOLS_DIR) {
        $pythonRoot = Join-Path $env:AI_STUDIO_TOOLS_DIR "python"
        foreach ($candidate in @((Join-Path $pythonRoot "python.exe")) + @(
            Get-ChildItem -LiteralPath $pythonRoot -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName "python.exe" }
        )) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }
    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
        return $command.Source
    }
    throw "Python 3.11 or newer was not found. Set PYTHON_PATH or AI_STUDIO_TOOLS_DIR."
}

if (-not $PythonPath) {
    $PythonPath = Find-Python
} elseif (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "Python executable does not exist: $PythonPath"
}
$PythonPath = (Resolve-Path -LiteralPath $PythonPath).Path
$pythonVersion = & $PythonPath -c "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.11 or newer is required; found $pythonVersion at $PythonPath"
}
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"

Write-Host "Python: $PythonPath ($pythonVersion)"
Write-Host "Environment: $VenvPath"
Write-Host "Requirements: $requirements"
Write-Host "This installs CPU Python packages only. It does not download Whisper model weights or run inference."
if ($PlanOnly) {
    Write-Host "Plan only: no files or packages changed."
    exit 0
}

if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    & $PythonPath -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) { throw "Python venv creation failed (exit $LASTEXITCODE)." }
}
if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    throw "Python environment was not created at $VenvPath"
}

& $VenvPython -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Sidecar dependency installation failed (exit $LASTEXITCODE)." }

$check = "import importlib.util,json,sys; mods=['faster_whisper','av','cv2','rapidocr_onnxruntime']; state={m: importlib.util.find_spec(m) is not None for m in mods}; print(json.dumps(state)); missing=[m for m,found in state.items() if not found]; print('Missing modules: '+', '.join(missing) if missing else 'All required modules are available.'); sys.exit(1 if missing else 0)"
& $VenvPython -c $check
if ($LASTEXITCODE -ne 0) { throw "Sidecar dependency check failed (exit $LASTEXITCODE)." }
Write-Host "Sidecar environment is ready. Whisper model weights will download only when a transcription is explicitly run."
