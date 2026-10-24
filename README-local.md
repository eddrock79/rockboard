# Banshee jukebox, local music edition (test branch `local-music`)

Plays your own MP3s from the NAS instead of Spotify. Same pages, balances and payments.

- `cloudflare-worker-local.js` + `wrangler-local.toml`: a SEPARATE test worker (`banshee-local-test`) that also serves the pages from `local-site/`. Deploy with `npx wrangler deploy -c wrangler-local.toml`. The live Spotify worker is untouched.
- `tools/scan-library.js` then `tools/build-catalogue.js`: read-only scan of the music folder, then tidy (merge artist spellings, drop skits under 45s, collapse duplicates) into `catalogue.json`.
- `tools/player.js upload`: sends the catalogue to the worker. `tools/player.js`: the player (needs mpv); plays paid requests first, then house music.
- Secrets for the test worker: SESSION_SECRET, DISPLAY_KEY, STAFF_PIN, PLAYER_KEY (optional: Stripe keys, ANTHROPIC_API_KEY).
- `local-site/` is a copy of index.html, board.html, staff.html with `workerUrl: ""` (same origin). Re-copy after changing the pages.
