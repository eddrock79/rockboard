# Deploys the local-music TEST worker (banshee-local-test) from GitHub. Does not touch the live Spotify jukebox.
$ErrorActionPreference = 'Stop'
$sha = '173892b714025a837c5022b2d5d7a56b47df16c1'
$tmp = Join-Path $env:TEMP 'banshee-local-deploy'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
Invoke-WebRequest "https://github.com/eddrock79/rockboard/archive/$sha.zip" -OutFile "$tmp\code.zip"
Expand-Archive "$tmp\code.zip" -DestinationPath "$tmp\x" -Force
$src = (Get-ChildItem "$tmp\x" | Select-Object -First 1).FullName
Push-Location $src
npx wrangler deploy -c wrangler-local.toml
Pop-Location
Remove-Item $tmp -Recurse -Force
Write-Host "`nDone. The test jukebox now has the new record and backdrop and the 7-minute cap."
