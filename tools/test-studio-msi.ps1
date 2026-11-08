param([Parameter(Mandatory)][ValidateSet('packages/ann-studio', 'packages/3d-studio')][string]$Package)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This install/uninstall check requires a disposable GitHub-hosted Windows runner.'
}
$artifacts = @(Get-ChildItem "$Package/src-tauri/target/release/bundle/msi/*.msi")
if ($artifacts.Count -ne 1) { throw "Expected one release MSI for $Package, found $($artifacts.Count)." }
$msi = $artifacts[0]
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.OpenDatabase($msi.FullName, 0)
$view = $db.OpenView("SELECT Value FROM Property WHERE Property = 'ProductCode'")
$view.Execute()
$product = $view.Fetch().StringData(1)
$view.Close()
if (!$product -or $installer.ProductState($product) -ne -1) { throw 'Expected an unregistered MSI product.' }

function Invoke-Msi([string[]]$Arguments) {
    $result = Start-Process msiexec.exe -ArgumentList ($Arguments + @('/qn', '/norestart')) -Wait -PassThru
    if ($result.ExitCode -notin @(0, 3010)) { throw "msiexec failed with exit code $($result.ExitCode)" }
}
try {
    Invoke-Msi @('/i', ('"{0}"' -f $msi.FullName))
    if ($installer.ProductState($product) -ne 5) { throw 'Windows Installer did not register the product as installed.' }
} finally {
    if ($installer.ProductState($product) -eq 5) { Invoke-Msi @('/x', $product) }
}
if ($installer.ProductState($product) -ne -1) { throw 'MSI product is still registered after uninstall.' }
Write-Host "Installed and uninstalled $($msi.Name) (SHA-256 $((Get-FileHash $msi.FullName).Hash))."
