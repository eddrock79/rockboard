// ============================================================
//  ROCKBOARD CONFIG
//  Swap this file (or just these values) per venue
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

  // ── VOTING RULES ─────────────────────────────────────────
  maxActionsPerHour: 5,
  maxLeaderboard:   10,

  // ── T-SHIRT COMPETITION ──────────────────────────────────
  tshirtMode:   true,
  tshirtText:   "MOST UNIQUE VOTES WINS A T-SHIRT",

  // ── STAFF ────────────────────────────────────────────────
  staffPin:     "1234",  // Change this to something only staff know!

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
const BLACK_ROSE = {
  venueName:   "THE BLACK ROSE",
  accent:      "#8B0000",
  lastfm_user: "blackrose_tidal",
  lastfm_key:  "78658e952901ff5d096dc83873d22049",
};

const BANSHEE = {
  venueName:   "THE BANSHEE LABYRINTH",
  accent:      "#2d0047",
  lastfm_user: "banshee_tidal",
  lastfm_key:  "",
};
*/
