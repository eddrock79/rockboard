# Edd & Cheryl Jukebox: update the pages and redeploy. Keeps your keys and settings.
$ErrorActionPreference = 'Stop'
$sha  = 'b5b726ae566161008eaf076e6d7f894eca27be58'
$root = "$HOME\rockboard-home"; $repo = "$root\repo"
Invoke-WebRequest "https://github.com/eddrock79/rockboard/archive/$sha.zip" -OutFile "$root\upd.zip"
Expand-Archive "$root\upd.zip" -DestinationPath "$root\upd" -Force
$src = (Get-ChildItem "$root\upd" | Select-Object -First 1).FullName
Remove-Item "$repo\home-site" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$src\home-site" "$repo\home-site" -Recurse -Force
Copy-Item "$src\tools\player.js" "$repo\tools" -Force
Copy-Item "$src\cloudflare-worker-home.js","$src\wrangler-home.toml" $repo -Force
Remove-Item "$root\upd" -Recurse -Force; Remove-Item "$root\upd.zip" -Force
Push-Location $repo; npx wrangler deploy -c wrangler-home.toml; Pop-Location
Write-Host "`nDone. Close the jukebox page on your phone and reopen it."
