# Edd & Cheryl Jukebox: add new music in one go.
# 1) copies new downloads (Amazon Music folder) to the NAS  2) rescans  3) fetches artwork  4) uploads to the jukebox.
# Never deletes or changes your existing music. The player keeps playing while this runs.
$ErrorActionPreference = 'Stop'
$tools = "$HOME\rockboard-home\repo\tools"
Set-Location $tools
$cfg  = Get-Content "$tools\player-config.json" -Raw | ConvertFrom-Json
$root = $cfg.musicRoot
function Step($n, $t) { Write-Host "`n[$n/5] $t" -ForegroundColor Green }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (code $LASTEXITCODE). Stopped." } }

Step 1 'Copying new downloads to the NAS...'
$cands = @("$HOME\Music\Amazon Music", "$HOME\Downloads\Amazon Music", "$HOME\Music\Amazon Music Downloads")
$src = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($src) {
  Write-Host "  from: $src"; Write-Host "  to:   $root\Amazon Music"
  robocopy $src "$root\Amazon Music" /E /XO /R:2 /W:2 /NFL /NDL /NJH /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Copy to the NAS failed. Stopped.' }
  $LASTEXITCODE = 0
} else {
  Write-Host '  No Amazon Music download folder found. Looked in:'; $cands | ForEach-Object { Write-Host "    $_" }
  Write-Host '  Carrying on with whatever is already on the NAS. (If your new album is elsewhere, copy it into the NAS Music folder first.)'
}

Step 2 'Scanning the music library (a few minutes)...'
node scan-library.js $root; Check 'Scan'
node build-catalogue.js; Check 'Catalogue'

Step 3 'Artwork...'
node build-art.js $root; Check 'Artwork'
node fetch-art-online.js; Check 'Online artwork'
node add-manual-art.js; Check 'Manual artwork'

Step 4 'Uploading songs to the jukebox...'
node player.js upload; Check 'Upload'

Step 5 'Uploading artwork...'
node player.js upload-art; Check 'Artwork upload'

Write-Host "`nDone. The new music is now searchable on the jukebox. Refresh the phone page if it's open." -ForegroundColor Green
