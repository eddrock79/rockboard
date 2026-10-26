# Deploys the LIVE Banshee jukebox worker (banshee-jukebox) from GitHub. Keeps all secrets and settings.
$ErrorActionPreference = 'Stop'
$sha = 'ffc7de76b66ca4c55c5038c183e478b708ceef1c'
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
Write-Host "`nDone. The live Banshee jukebox now adds BANSHEE to card statements."
