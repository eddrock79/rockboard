# Deploys the LIVE Banshee jukebox worker (banshee-jukebox) from GitHub. Keeps all secrets and settings.
$ErrorActionPreference = 'Stop'
$sha = '59e286f91c8c8bb3053c0770a6e2cba2152970a1'
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
Write-Host "`nDone. The live Banshee jukebox now has blocked artists and blocked songs."
