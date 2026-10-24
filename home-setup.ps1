# Edd & Cheryl Jukebox: one-go setup (download, deploy, secrets, config). Safe to re-run? Run it once.
$ErrorActionPreference = 'Stop'
$sha  = '9f3a598a36e36469fc0d2d2a51fa6c0b8d7c7075'
$root = "$HOME\rockboard-home"
$old  = "$HOME\rockboard-local-music\tools"
if (-not (Test-Path "$old\catalogue.json")) { throw "Can't find $old\catalogue.json (your local-music folder)." }
New-Item -ItemType Directory -Force $root | Out-Null
Write-Host '1/6 Downloading...'
Invoke-WebRequest "https://github.com/eddrock79/rockboard/archive/$sha.zip" -OutFile "$root\code.zip"
Expand-Archive "$root\code.zip" -DestinationPath "$root\unz" -Force
$repo = "$root\repo"
if (Test-Path $repo) { Remove-Item $repo -Recurse -Force }
Move-Item (Get-ChildItem "$root\unz" | Select-Object -First 1).FullName $repo
Remove-Item "$root\unz" -Recurse -Force
Write-Host '2/6 Copying your music list and artwork across...'
Copy-Item "$old\catalogue.json" "$repo\tools\" -Force
if (Test-Path "$old\art") { Copy-Item "$old\art" "$repo\tools\art" -Recurse -Force }
Write-Host '3/6 Installing (a minute or two)...'
Push-Location "$repo\tools"; npm install --silent; Pop-Location
Write-Host '4/6 Deploying the jukebox...'
Push-Location $repo
npx wrangler deploy -c wrangler-home.toml
Write-Host '5/6 Setting secret keys (made up for you, nothing to type)...'
function Rand($n) { -join ((48..57 + 65..90 + 97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
$k = @{ SESSION_SECRET = (Rand 32); DISPLAY_KEY = (Rand 14); PLAYER_KEY = (Rand 24); STAFF_PIN = (-join (1..6 | ForEach-Object { Get-Random -Max 10 })) }
foreach ($n in $k.Keys) { $k[$n] | npx wrangler secret put $n -c wrangler-home.toml | Out-Null }
Pop-Location
Write-Host '6/6 Writing the player settings...'
$url = 'https://edd-cheryl-jukebox.eddrock79.workers.dev'
$cfg = Get-Content "$old\player-config.json" -Raw | ConvertFrom-Json
$cfg.workerUrl = $url; $cfg.playerKey = $k.PLAYER_KEY
$cfg | ConvertTo-Json -Depth 5 | Set-Content "$repo\tools\player-config.json" -Encoding UTF8
@"
EDD & CHERYL JUKEBOX
TV board:  $url/board?key=$($k.DISPLAY_KEY)
Admin:     $url/staff   (PIN $($k.STAFF_PIN))
"@ | Set-Content "$root\my-links.txt"
Get-Content "$root\my-links.txt"
Write-Host "`nSaved in $root\my-links.txt. Setup done."
