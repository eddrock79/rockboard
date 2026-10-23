# The Banshee Labyrinth Jukebox

A pay-to-queue jukebox for a 32" portrait TV. Guests scan the QR code on the screen, buy plays with Stripe, search for a song and it joins the Spotify queue. The screen shows what's playing, what's next and **how long until each song plays**.

This is separate from the Black Rose "rockboardBR" board: its own Spotify account, its own worker, its own ledger. It only shares your Stripe account.

| File | What it is |
| --- | --- |
| `board.html` | The TV screen (1080 × 1920, scales to fit) |
| `index.html` | The page guests get after scanning |
| `staff.html` | Staff page: skip, pause, add a track, give plays, see sales |
| `cloudflare-worker.js` | The backend: Spotify, Stripe, play credits, AI fun facts |
| `config.js` | Public settings (worker address and the prices shown) |
| `callback.html` | One-off page used while connecting Spotify |
| `wrangler.toml` | Worker settings |

## How it works

- No free plays. £1 = 2 plays, £2 = 5 plays. The prices live in `TIERS` in `cloudflare-worker.js` (the worker is the only thing that decides what a payment is worth). Keep `config.js` in step so the screen shows the same numbers.
- A guest's balance is kept by the worker, not on their phone. The worker takes the play **before** it queues the song and gives it back if Spotify refuses.
- The QR code on the screen carries a token that changes every 2 hours, so only people in the pub can start. The staff PIN is checked by the worker, never in the page.
- The music plays from **Spotify on the TV PC**. Songs bought are added to the Spotify queue. When nobody has paid, whatever playlist you have playing carries on.

## Setting it up (one step at a time)

You'll need: a Spotify **Premium** account for the Banshee, a Cloudflare account, your Stripe account, and Node.js on the PC.

1. **Spotify developer app.** Log into https://developer.spotify.com/dashboard with the Banshee account, create an app, and add this redirect URI: `https://rockboard.hauntedpubs.co.uk/callback.html`. Note the Client ID and Client Secret.
2. **Get the refresh token.** Open this address (swap in your Client ID):
   `https://accounts.spotify.com/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=https%3A%2F%2Frockboard.hauntedpubs.co.uk%2Fcallback.html&scope=user-read-playback-state%20user-modify-playback-state%20user-read-currently-playing`
   Approve it, copy the code from the page, then swap it for a refresh token (the setup guide walks through this).
3. **Deploy the worker.** In this folder run `npx wrangler deploy`, then add each secret with `npx wrangler secret put NAME`:
   `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SESSION_SECRET` (any long random text), `DISPLAY_KEY` (any long random text), `STAFF_PIN`, and optionally `ANTHROPIC_API_KEY` for the AI fun facts.
4. **Stripe webhook.** In Stripe add an endpoint `https://YOUR-WORKER.workers.dev/stripe-webhook` for the event `checkout.session.completed`. Use its signing secret as `STRIPE_WEBHOOK_SECRET`. Start in test mode.
5. **Point the pages at the worker.** Put your worker address in `config.js` (`workerUrl`).
6. **On the TV PC.** Open Spotify, start a Banshee playlist playing, then open `https://rockboard.hauntedpubs.co.uk/board.html?key=YOUR_DISPLAY_KEY` once in fullscreen (F11). The key is remembered on that PC.

## Notes

- Spotify's queue can't be edited by apps, so staff can skip but not remove a queued track.
- Stripe sends events from the whole account to every webhook. This worker ignores anything not made by the Banshee, but check the Black Rose worker does the same.
