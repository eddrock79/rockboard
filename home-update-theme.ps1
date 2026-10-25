# Update only the home jukebox's appearance. Keep the installed player and settings.
$ErrorActionPreference = 'Stop'
$repo = Join-Path $HOME 'rockboard-home\repo'
if (!(Test-Path (Join-Path $repo 'wrangler-home.toml')) -or !(Test-Path (Join-Path $repo 'home-site\config.js'))) {
  throw 'Home jukebox installation not found in rockboard-home\repo. No files were changed.'
}
$source = 'https://raw.githubusercontent.com/eddrock79/rockboard/bbdb8bb26d6043da412ef8d742e154edc9306b5b/home-site'
$files = @('theme.css', 'theme.js', 'assets/cathedral.svg', 'assets/ghost-wordmark.webp')
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('jukebox-theme-' + [guid]::NewGuid().ToString('N'))
try {
  # Download everything before replacing any installed file.
  foreach ($file in $files) {
    $target = Join-Path $temp $file
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Invoke-WebRequest "$source/$file" -OutFile $target
  }
  foreach ($file in $files) {
    $target = Join-Path (Join-Path $repo 'home-site') $file
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item (Join-Path $temp $file) $target -Force
  }
  Push-Location $repo
  try {
    npx wrangler deploy -c wrangler-home.toml
    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. The theme files are ready; rerun the update to retry.' }
  } finally { Pop-Location }
  Write-Host "`nTheme updated. Refresh the jukebox pages. Select GHOST in the admin page when you want to use it."
  Write-Host 'Your current theme selection, configuration, player and keys have been kept.'
} finally {
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}
