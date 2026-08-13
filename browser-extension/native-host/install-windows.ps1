param(
  [Parameter(Mandatory = $true)][string]$ExtensionId,
  [Parameter(Mandatory = $true)][string]$LensQueryExe
)

$ErrorActionPreference = "Stop"
$ResolvedExe = (Resolve-Path $LensQueryExe).Path
$InstallDir = Join-Path $env:LOCALAPPDATA "LensQuery\NativeMessaging"
$ManifestPath = Join-Path $InstallDir "com.lensquery.desktop.json"
$HostPath = Join-Path $InstallDir "lensquery-native-host.cmd"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$escapedExe = $ResolvedExe.Replace('"', '""')
Set-Content -Encoding ASCII -Path $HostPath -Value "@echo off`r`n`"$escapedExe`" --native-messaging-host"

$manifest = @{
  name = "com.lensquery.desktop"
  description = "LensQuery browser-to-desktop context bridge"
  path = $HostPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4
Set-Content -Encoding UTF8 -Path $ManifestPath -Value $manifest

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.lensquery.desktop" /ve /t REG_SZ /d $ManifestPath /f | Out-Null
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.lensquery.desktop" /ve /t REG_SZ /d $ManifestPath /f | Out-Null

Write-Host "Installed LensQuery Native Messaging host for Chrome and Edge."
Write-Host "Manifest: $ManifestPath"
