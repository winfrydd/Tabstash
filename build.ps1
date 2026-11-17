# Packs the extension:
#   dist\tabstash-firefox.zip  (upload to addons.mozilla.org "On your own" for signing)
#   dist\tabstash-chrome.zip   (or load src\ ... see README for Chrome)
# Zip entries use forward slashes (Compress-Archive on PowerShell 5.1 does not, and AMO rejects that).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$dist = Join-Path $root 'dist'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force $dist | Out-Null

function Pack([string]$zipPath, [string]$manifestJson, [scriptblock]$skip) {
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    Get-ChildItem $src -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
      if ($rel -eq 'manifest.json' -or (& $skip $rel)) { return }
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal')
    }
    $entry = $zip.CreateEntry('manifest.json')
    $w = New-Object IO.StreamWriter($entry.Open(), (New-Object Text.UTF8Encoding $false))
    $w.Write($manifestJson)
    $w.Dispose()
  } finally { $zip.Dispose() }
  Write-Output "Built $zipPath"
}

$raw = Get-Content (Join-Path $src 'manifest.json') -Raw

# Firefox: manifest as is, no PNG icons needed.
Pack (Join-Path $dist 'tabstash-firefox.zip') $raw { param($r) $r -like 'icons/*.png' }

# Chrome: service worker, contextMenus, local favicon cache, PNG icons, no Firefox keys.
$m = $raw | ConvertFrom-Json
$m.PSObject.Properties.Remove('browser_specific_settings')
$m.permissions = @('tabs', 'storage', 'contextMenus', 'favicon', 'unlimitedStorage')
$m.background = [ordered]@{ service_worker = 'background.js'; type = 'module' }
$png = [ordered]@{ '16' = 'icons/icon-16.png'; '32' = 'icons/icon-32.png'; '48' = 'icons/icon-48.png'; '128' = 'icons/icon-128.png' }
$m.action.default_icon = $png
$m.icons = $png
Pack (Join-Path $dist 'tabstash-chrome.zip') ($m | ConvertTo-Json -Depth 10) { param($r) $false }
