# Edd & Cheryl Jukebox (home edition)
Free plays, no payments. Each phone can have up to 5 songs waiting at once (`MAX_QUEUED` in cloudflare-worker-home.js).
Worker: `wrangler-home.toml` (name edd-cheryl-jukebox). Pages: `home-site/`. Player and catalogue tools: `tools/` (same as local-music).
Deploy: `npx wrangler deploy -c wrangler-home.toml`, then set secrets SESSION_SECRET, DISPLAY_KEY, STAFF_PIN, PLAYER_KEY.

## Ghost landscape theatre

Select **Ghost** in the admin page. On landscape screens the board uses a 1920 x 1080 composition and scales to the TV; portrait screens retain the portrait layout. **Full screen** (or F11) fills the display.

- **The Cathedral**: original panoramic artwork with drifting fog, light shafts, embers and a rotating celestial album frame.
- **Impera / Skeletá**: official animated artwork served locally as silent visual scenes. Changing a scene does not change the music. Only the selected video plays, and it pauses with playback.
- **Art View**: hides the jukebox panels and leaves the artwork with a small now-playing caption. **Show Jukebox** returns to the controls.
- **Choose Music**: opens the existing phone library inside the board. Requests and play/pause/next use the existing rotating session and existing worker endpoints.
- **Atmosphere**: stops visual motion. The board also respects the browser's reduced-motion preference.

Run `home-update-theme.cmd` from Command Prompt, or `home-update-theme.ps1` from PowerShell, on the existing home jukebox PC. These updaters stage the board and artwork before copying them; they preserve `home-site/config.js`, the player files, worker configuration, keys and selected theme. Artwork sources and the generation prompt are documented in `home-site/assets/README.md`.
