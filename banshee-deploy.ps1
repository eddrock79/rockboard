# Deploys the LIVE Banshee jukebox worker (banshee-jukebox) from GitHub. Keeps all secrets and settings.
$ErrorActionPreference = 'Stop'
$sha = 'abe26aaab34d6b370cf0e56aac9a21e86d960591'
$tmp = Join-Path $env:TEMP 'banshee-live-deploy'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
Invoke-WebRequest "https://github.com/eddrock79/rockboard/archive/$sha.zip" -OutFile "$tmp\code.zip"
Expand-Archive "$tmp\code.zip" -DestinationPath "$tmp\x" -Force
$src = (Get-ChildItem "$tmp\x" | Select-Object -First 1).FullName
Push-Location $src
npx wrangler deploy
Pop-Location
Remove-Item $tmp -Recurse -Force
Write-Host "`nDone. The live Banshee jukebox now has a closing time, so songs that would run past it can't be requested."
