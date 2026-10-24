# Uploads the music list + artwork, then starts the player. Run after the Cloudflare reset (after 1am UK).
$ErrorActionPreference = 'Stop'
Set-Location "$HOME\rockboard-home\repo\tools"
node player.js upload
node player.js upload-art
Write-Host "`nUploaded. Starting the player (leave this window open; Ctrl+C stops it)..."
node player.js
