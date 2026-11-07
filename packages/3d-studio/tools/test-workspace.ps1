$ErrorActionPreference = 'Stop'
$studioTestExe = Join-Path ([System.IO.Path]::GetTempPath()) ('g-suite-studio-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    & rustc --edition=2021 --test (Join-Path $PSScriptRoot '../src-tauri/src/workspace_tests.rs') -o $studioTestExe
    if ($LASTEXITCODE -ne 0) { throw 'Workspace test compilation failed.' }
    & $studioTestExe
    if ($LASTEXITCODE -ne 0) { throw 'Workspace regression tests failed.' }
} finally {
    if (Test-Path -LiteralPath $studioTestExe) { Remove-Item -LiteralPath $studioTestExe }
}
