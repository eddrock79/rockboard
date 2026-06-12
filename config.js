// ============================================================
//  ROCKBOARD CONFIG
//  Swap this file (or just these values) per venue
// ============================================================

const VENUE_CONFIG = {

  // ── VENUE IDENTITY ──────────────────────────────────────
  venueName:    "THE BLACK ROSE",        // Displayed on all screens
  venueSub:     "▶ ROCKBOARD · VOTE FOR YOUR TRACK",
  accent:       "#8B0000",               // Brand colour (hex)
  logo:         "assets/blackrose.png",  // Optional logo path

  // ── LAST.FM (Now Playing) ────────────────────────────────
  // 1. Create free account at https://last.fm
  // 2. Get API key at https://last.fm/api/account/create
  // 3. Connect Tidal: Tidal Settings → Connected Apps → Last.fm
  lastfm_user:  "eddrock79",                      // e.g. "blackrose_tidal"
  lastfm_key:   "78658e952901ff5d096dc83873d22049",                      // Your Last.fm API key

  // ── VOTING RULES ─────────────────────────────────────────
  maxActionsPerHour: 5,                  // Requests + votes combined per device per hour
  maxLeaderboard:   10,                  // How many tracks show on the board

  // ── T-SHIRT COMPETITION ──────────────────────────────────
  tshirtMode:   true,                    // Show t-shirt prize badge (staff can toggle live)
  tshirtText:   "MOST UNIQUE VOTES WINS A T-SHIRT",

  // ── STAFF ────────────────────────────────────────────────
  staffPin:     "1234",                  // Change this! Used on staff.html

  // ── FIREBASE (Live voting database) ──────────────────────
  // 1. Go to https://console.firebase.google.com
  // 2. Create a new project (free Spark plan is fine)
  // 3. Add a Web app, copy the config below
  // 4. Enable Firestore Database (Start in test mode)
  firebase: {
    apiKey:            "",
    authDomain:        "",
    projectId:         "",
    storageBucket:     "",
    messagingSenderId: "",
    appId:             "",
  },

  // ── NIGHT RESET ──────────────────────────────────────────
  // Time (24hr) at which the nightly competition auto-resets
  // Set to e.g. "03:00" for 3am closing time
  nightResetTime: "03:00",

};

// ── PER-VENUE PRESETS ─────────────────────────────────────
// Uncomment the one you want, or import this file and
// override VENUE_CONFIG with one of these:

/*
const BLACK_ROSE = {
  venueName: "THE BLACK ROSE",
  accent: "#8B0000",
  lastfm_user: "blackrose_tidal",
};

const BANSHEE = {
  venueName: "THE BANSHEE LABYRINTH",
  accent: "#2d0047",
  lastfm_user: "banshee_tidal",
};

const HOME_TRIAL = {
  venueName: "ROCKBOARD · HOME TRIAL",
  accent: "#004466",
  lastfm_user: "",   // no Last.fm needed for testing
};
*/
