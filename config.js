// ============================================================
//  ROCKBOARD CONFIG — swap this file per venue
// ============================================================

const VENUE_CONFIG = {

  // ── VENUE IDENTITY ──────────────────────────────────────
  venueName:    "THE BLACK ROSE",
  venueSub:     "▶ ROCKBOARD · VOTE FOR YOUR TRACK",
  accent:       "#8B0000",
  logo:         "assets/blackrose.png",

  // ── LAST.FM (Now Playing) ────────────────────────────────
  lastfm_user:  "eddrock79",
  lastfm_key:   "78658e952901ff5d096dc83873d22049",

  // ── VOTING RULES (set low for live, high for testing) ────
  maxRequestsPerHour: 40,    // track requests per device per hour
  maxVotesPerHour:   100,    // votes per device per hour
  maxLeaderboard:     10,    // how many tracks show on the board

  // ── T-SHIRT COMPETITION ──────────────────────────────────
  tshirtMode:   true,        // true = show prize badge, false = hide it
  tshirtText:   "MOST UNIQUE VOTES WINS A T-SHIRT",

  // ── STAFF ────────────────────────────────────────────────
  staffPin:     "1234",      // change this!

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
  venueName:   "THE BANSHEE LABYRINTH",
  accent:      "#2d0047",
  lastfm_user: "banshee_tidal",
  lastfm_key:  "",
};
*/
