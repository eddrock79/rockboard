// ============================================================
//  ROCKBOARD CONFIG — swap this file per venue
// ============================================================

const VENUE_CONFIG = {

  // ── VENUE IDENTITY ──────────────────────────────────────
  venueName:    "THE BLACK ROSE",
  venueSub:     "▶ ROCKBOARD · VOTE FOR YOUR TRACK",
  accent:       "#8B0000",
  logo:         "assets/blackrose.png",

  // ── LAST.FM (Now Playing display) ────────────────────────
  lastfm_user:  "eddrock79",
  lastfm_key:   "78658e952901ff5d096dc83873d22049",

  // ── YOUTUBE (Music video background) ─────────────────────
  // Get free key at: console.cloud.google.com
  // Enable: YouTube Data API v3 → Credentials → API Key
  youtube_key:  "AIzaSyCjTo6q-KwV051JIT70GB9F4-ZPDS8dMo4",

  // ── SPOTIFY (Auto-queue via Cloudflare Worker) ───────────
  spotify_worker_url:    "https://rockboard.eddrock79.workers.dev",  // ← fill this in after deploying worker
  spotify_playlist_id:   "3lj6qRLWbJKbFkXtrlJCHc",

  // ── VOTING RULES ─────────────────────────────────────────
  maxRequestsPerHour: 40,
  maxVotesPerHour:   100,
  maxLeaderboard:     10,

  // ── T-SHIRT COMPETITION ──────────────────────────────────
  tshirtMode:   true,
  tshirtText:   "MOST UNIQUE VOTES WINS A T-SHIRT",

  // ── STAFF ────────────────────────────────────────────────
  staffPin:     "1234",  // change this!

  // ── FIREBASE ─────────────────────────────────────────────
  firebase: {
    apiKey:            "AIzaSyCBV3mususv2A_ss0vEiUDxA6PBGCOLCgc",
    authDomain:        "rockboard-2b240.firebaseapp.com",
    projectId:         "rockboard-2b240",
    storageBucket:     "rockboard-2b240.firebasestorage.app",
    messagingSenderId: "875047215481",
    appId:             "1:875047215481:web:89616e2e219aa6396d0fa8",
  },

  // ── NIGHT RESET ──────────────────────────────────────────
  nightResetTime: "03:00",

};

// ── PER-VENUE PRESETS ─────────────────────────────────────
/*
const BANSHEE = {
  venueName:             "THE BANSHEE LABYRINTH",
  accent:                "#2d0047",
  lastfm_user:           "banshee_tidal",
  lastfm_key:            "",
  spotify_worker_url:    "https://rockboard-banshee.YOUR-SUBDOMAIN.workers.dev",
  spotify_playlist_id:   "YOUR_BANSHEE_PLAYLIST_ID",
};
*/
