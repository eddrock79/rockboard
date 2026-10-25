# Update only the home jukebox's appearance. Keep the installed player and settings.
$ErrorActionPreference = 'Stop'
$repo = Join-Path $HOME 'rockboard-home\repo'
if (!(Test-Path (Join-Path $repo 'wrangler-home.toml')) -or !(Test-Path (Join-Path $repo 'home-site\config.js'))) {
  throw 'Home jukebox installation not found in rockboard-home\repo. No files were changed.'
}
$source = 'https://raw.githubusercontent.com/eddrock79/rockboard/538b40f062101cc9e39ef1233f7826bbd9d22d96/home-site'
$files = @(
  'board.html',
  'theme.css',
  'theme.js',
  'ghost-board.css',
  'assets/cathedral.svg',
  'assets/ghost-wordmark.webp',
  'assets/ghost-cathedral.webp',
  'assets/ghost-impera.webp',
  'assets/ghost-skeleta.webp',
  'assets/ghost-impera-loop.mp4',
  'assets/ghost-skeleta-loop.mp4'
)
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
  Write-Host "`nLandscape theme updated. Refresh the board, select GHOST and use FULL SCREEN or F11."
  Write-Host 'Your current theme selection, configuration, player and keys have been kept.'
} finally {
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}
