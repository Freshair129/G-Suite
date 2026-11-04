$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$runRoot = Join-Path $tempRoot ('g-suite-banner-roundtrip-' + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $runRoot 'studio-output.banner.zip'
$annTestStdout = Join-Path $runRoot 'annstudio-roundtrip.stdout.log'
$annTestStderr = Join-Path $runRoot 'annstudio-roundtrip.stderr.log'
$sourcePath = (Resolve-Path (Join-Path $repositoryRoot 'packages/3d-studio/src-tauri/icons/128x128.png')).Path
$environmentNames = @(
    'G_SUITE_BANNER_E2E_SOURCE',
    'G_SUITE_BANNER_E2E_CAPTURE',
    'G_SUITE_BANNER_E2E_ARCHIVE'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

New-Item -ItemType Directory -Path $runRoot | Out-Null
try {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    & $nodePath (Join-Path $repositoryRoot 'tools/prepare-ann-media.mjs') --check
    if ($LASTEXITCODE -ne 0) { throw 'Pinned AnnStudio media tools must be prepared before the round trip.' }

    $env:G_SUITE_BANNER_E2E_SOURCE = $sourcePath
    $env:G_SUITE_BANNER_E2E_CAPTURE = $archivePath
    & cargo test --locked --manifest-path (Join-Path $repositoryRoot 'packages/3d-studio/src-tauri/Cargo.toml') 'banner_asset_export::tests::exports_a_verified_still_asset_into_an_immutable_project_revision' -- --exact
    if ($LASTEXITCODE -ne 0) { throw '3D Studio producer fixture export failed.' }
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw '3D Studio producer did not emit the expected ZIP.' }

    $env:G_SUITE_BANNER_E2E_ARCHIVE = $archivePath
    $cargoPath = (Get-Command cargo -ErrorAction Stop).Source
    $annManifest = Join-Path $repositoryRoot 'packages/ann-studio/src-tauri/Cargo.toml'
    $annArguments = @('test', '--locked', '--manifest-path', $annManifest, 'project_io::tests::imports_studio_producer_archive_and_reopens_the_saved_project', '--', '--ignored', '--exact')
    $annProcess = Start-Process -FilePath $cargoPath -ArgumentList $annArguments -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $annTestStdout -RedirectStandardError $annTestStderr
    $annTestExitCode = $annProcess.ExitCode
    $annTestText = (Get-Content -LiteralPath $annTestStdout -Raw) + "`n" + (Get-Content -LiteralPath $annTestStderr -Raw)
    Write-Output $annTestText
    if ($annTestExitCode -ne 0) { throw 'AnnStudio import and project reopen failed for the Studio-produced ZIP.' }
    if ($annTestText -notmatch 'running 1 test' -or $annTestText -notmatch '1 passed; 0 failed') {
        throw 'The AnnStudio producer round-trip test did not run exactly as expected.'
    }
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }

    $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $isNamedTaskRoot = [System.IO.Path]::GetFileName($resolvedRunRoot).StartsWith('g-suite-banner-roundtrip-', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $resolvedRunRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not $isNamedTaskRoot) {
        throw "Refusing to remove an unexpected round-trip directory: $resolvedRunRoot"
    }
    if (Test-Path -LiteralPath $resolvedRunRoot) {
        Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
    }
}
