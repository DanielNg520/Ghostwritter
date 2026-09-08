# Ghost Writer native messaging host installer for Windows (best-effort;
# macOS is the primary target for this project — see docs/plan_v2_generalist.md).
#
# Usage: .\install.ps1 -ExtensionId <extension-id>
#
# <extension-id> is the ID Chrome assigns the extension, shown on its card
# at chrome://extensions (with Developer mode on) after loading the
# 'extension/' folder as unpacked. Because extension/manifest.json pins a
# stable "key" field, this ID stays stable across reloads.

param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TemplatePath = Join-Path $ScriptDir "com.ghostwriter.host.json.template"
$HostPyPath = Join-Path $ScriptDir "host.py"
$ManifestPath = Join-Path $ScriptDir "com.ghostwriter.host.json"

# host.py path needs escaped backslashes to be valid inside the JSON string.
$HostPyPathJson = $HostPyPath -replace '\\', '\\\\'

$template = Get-Content -Raw -Path $TemplatePath
$manifest = $template `
    -replace '__HOST_PY_PATH__', $HostPyPathJson `
    -replace '__EXTENSION_ID__', $ExtensionId

Set-Content -Path $ManifestPath -Value $manifest -Encoding UTF8

$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ghostwriter.host"
New-Item -Path $RegistryKey -Force | Out-Null
Set-ItemProperty -Path $RegistryKey -Name "(Default)" -Value $ManifestPath

Write-Host "Installed native messaging host manifest:"
Write-Host "  $ManifestPath"
Write-Host "Registered under:"
Write-Host "  $RegistryKey"
Write-Host "Pointing at host: $HostPyPath"
Write-Host "Allowed extension ID: $ExtensionId"
Write-Host ""
Write-Host "Note: this script assumes 'python' (or an equivalent launcher) is on PATH"
Write-Host "to run host.py; adjust host.py's shebang usage / associate .py with Python"
Write-Host "if native messaging fails to launch the host on Windows."
Write-Host ""
Write-Host "Reload the extension in chrome://extensions and try it out."
