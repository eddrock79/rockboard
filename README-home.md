# Edd & Cheryl Jukebox (home edition)
Free plays, no payments. Each phone can have up to 5 songs waiting at once (`MAX_QUEUED` in cloudflare-worker-home.js).
Worker: `wrangler-home.toml` (name edd-cheryl-jukebox). Pages: `home-site/`. Player and catalogue tools: `tools/` (same as local-music).
Deploy: `npx wrangler deploy -c wrangler-home.toml`, then set secrets SESSION_SECRET, DISPLAY_KEY, STAFF_PIN, PLAYER_KEY.
