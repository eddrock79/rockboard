// Banshee jukebox: turn the raw scan into a tidy catalogue. READ ONLY on your music.
// Usage:  node build-catalogue.js        (after scan-library.js; takes a second, rerun it any time)
// Reads raw-scan.json. Writes catalogue.json (what guests can search) and catalogue-report.txt.
// Optional: edit catalogue-rules.json to hide artists/folders or fix names (see bottom of this file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rawFile = path.join(__dirname, 'raw-scan.json');
if (!fs.existsSync(rawFile)) { console.error('Run scan-library.js first.'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
const rulesFile = path.join(__dirname, 'catalogue-rules.json');
const userRules = fs.existsSync(rulesFile) ? JSON.parse(fs.readFileSync(rulesFile, 'utf8')) : {};
const DEFAULTS = {
  minSeconds: 45,
  maxSeconds: 1500, // 25 minutes: keeps full-album files off the jukebox
  hideTitleContains: ['(Full Album)'],
  hideArtists: [],
  hideFolders: [],
  folderArtists: { 'CD 1. Tenacious D': 'Tenacious D' }, // files with no tags: take the artist from the folder name
  renameArtists: { "Guns N' Roses": "Guns N' Roses", 'Simon & Garfunkel': 'Simon & Garfunkel', 'The Weather Girls': 'The Weather Girls' },
};
const rules = { ...DEFAULTS, ...userRules,
  hideTitleContains: [...DEFAULTS.hideTitleContains, ...(userRules.hideTitleContains || [])],
  folderArtists: { ...DEFAULTS.folderArtists, ...(userRules.folderArtists || {}) },
  renameArtists: { ...DEFAULTS.renameArtists, ...(userRules.renameArtists || {}) } };
const MIN_SECONDS = rules.minSeconds;
const MAX_SECONDS = rules.maxSeconds;
// Some old tags carry stray Chinese/Korean characters on the end of an English name (a text-encoding fault). Strip them.
let repaired = 0;
function fixText(s) {
  s = String(s || '');
  if (/[\u3400-\u9fff\uac00-\ud7af\ua000-\ua4cf]/.test(s) && /[A-Za-z]/.test(s)) { repaired++; return s.replace(/[\u3400-\u9fff\uac00-\ud7af\ua000-\ua4cf]+/g, '').replace(/\s+/g, ' ').trim(); }
  return s;
}
const folderArtists = Object.fromEntries(Object.entries(rules.folderArtists).map(([k, v]) => [k.toLowerCase(), v]));
const hideTitles = rules.hideTitleContains.map(x => x.toLowerCase());
const hideArtists = new Set((rules.hideArtists || []).map(a => artistKey(a)));
const hideFolders = (rules.hideFolders || []).map(f => f.toLowerCase());
const renameArtists = Object.fromEntries(Object.entries(rules.renameArtists || {}).map(([k, v]) => [artistKey(k), v]));

function cleanTitle(n) {
  return String(n || '')
    .replace(/\s*(?:-|–|\(|\[)\s*(?:\d{4}\s*-?\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*[)\]]?\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}
function norm(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function artistKey(s) { return norm(s).replace(/^the /, '').replace(/ and /g, ' '); }
const hash = (s, n) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const extRank = { '.mp3': 3, '.m4a': 2, '.flac': 3, '.wma': 1 };

// 1. Drop unusable rows
const removed = { noArtist: [], short: [], long: [], hidden: [] };
let rows = [];
for (const t of raw) {
  t.artist = fixText(t.artist); t.title = fixText(t.title); t.album = fixText(t.album);
  if (!t.artist) {
    const hit = t.path.split('/').slice(0, -1).map(seg => folderArtists[seg.toLowerCase()]).find(Boolean);
    if (hit) t.artist = hit;
  }
  if (!t.artist || !t.title) { removed.noArtist.push(t.path); continue; }
  if (t.seconds && t.seconds < MIN_SECONDS) { removed.short.push(t.path); continue; }
  if (t.seconds && t.seconds > MAX_SECONDS) { removed.long.push(t.path); continue; }
  if (hideTitles.some(x => t.title.toLowerCase().includes(x))) { removed.hidden.push(t.path); continue; }
  const k = artistKey(t.artist);
  if (hideArtists.has(k) || hideFolders.some(f => t.path.toLowerCase().startsWith(f))) { removed.hidden.push(t.path); continue; }
  rows.push(t);
}

// 2. Merge artist spellings: choose one display name per artist key
const groups = {};
for (const t of rows) (groups[artistKey(t.artist)] = groups[artistKey(t.artist)] || []).push(t.artist);
const display = {};
for (const [k, names] of Object.entries(groups)) {
  const count = {}; names.forEach(n => count[n] = (count[n] || 0) + 1);
  const mixed = n => n !== n.toLowerCase() && n !== n.toUpperCase();
  const withThe = Object.keys(count).filter(n => /^the\s/i.test(n));
  const pool = withThe.length ? withThe : Object.keys(count);
  const best = pool.sort((a, b) => (mixed(b) - mixed(a)) || (count[b] - count[a]))[0];
  display[k] = renameArtists[k] || best;
}

// 3. Collapse duplicates: same artist + title + roughly the same length
const bestOf = new Map(), dupes = [];
const score = t => (t.source === 'tags' ? 4 : 0) + (extRank[t.ext] || 0) + (t.album ? 1 : 0) + (/greatest|hits|now that|best of|compilation|various|\d{2,3}s?\b/i.test(t.path.split('/')[0]) ? -1 : 0);
for (const t of rows) {
  const key = artistKey(t.artist) + '|' + norm(cleanTitle(t.title));
  const list = bestOf.get(key) || [];
  const twin = list.find(o => Math.abs((o.seconds || 0) - (t.seconds || 0)) <= 15);
  if (!twin) { list.push(t); bestOf.set(key, list); continue; }
  if (score(t) > score(twin)) { list[list.indexOf(twin)] = t; dupes.push(twin.path); } else dupes.push(t.path);
}
const keep = [...bestOf.values()].flat();

// 4. Final catalogue
const out = keep.map(t => {
  const k = artistKey(t.artist);
  return {
    id: hash(t.path, 10), path: t.path,
    artist: display[k], artistId: hash(k, 8),
    title: cleanTitle(t.title), album: t.album || '', seconds: t.seconds || 0,
    coverId: t.album ? hash((t.album + '|' + path.posix.dirname(t.path)).toLowerCase(), 10) : '',
  };
}).sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
fs.writeFileSync(path.join(__dirname, 'catalogue.json'), JSON.stringify(out));

// 5. Report
const L = [];
const artists = {}; out.forEach(t => artists[t.artist] = (artists[t.artist] || 0) + 1);
L.push('CATALOGUE REPORT  (' + new Date().toLocaleString('en-GB') + ')');
L.push('Scanned files: ' + raw.length + '   In catalogue: ' + out.length + '   Artists: ' + Object.keys(artists).length);
L.push('Left out: ' + removed.noArtist.length + ' with no artist, ' + removed.short.length + ' under ' + MIN_SECONDS + 's, ' + removed.long.length + ' over ' + Math.round(MAX_SECONDS / 60) + ' min, ' + removed.hidden.length + ' hidden by rules, ' + dupes.length + ' duplicates merged');
L.push('Names repaired (stray characters removed): ' + repaired);
L.push('Playing time in catalogue: ' + Math.round(out.reduce((s, t) => s + t.seconds, 0) / 3600) + ' hours');
const long = out.filter(t => t.seconds > 900);
L.push('Over 15 minutes (check they are real songs): ' + long.length);
long.slice(0, 15).forEach(t => L.push('   ' + Math.round(t.seconds / 60) + 'min  ' + t.artist + ' - ' + t.title));
L.push('\nTOP 30 ARTISTS:'); Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([n, c]) => L.push('  ' + n + ' (' + c + ')'));
L.push('\nSPELLINGS MERGED (first 25):');
Object.entries(groups).filter(([k, n]) => new Set(n).size > 1).slice(0, 25).forEach(([k, n]) => L.push('  ' + [...new Set(n)].join(' | ') + '  ->  ' + display[k]));
L.push('\nLEFT OUT: too long:'); removed.long.concat(removed.hidden).slice(0, 20).forEach(p => L.push('  ' + p));
L.push('\nLEFT OUT: no artist (first 20):'); removed.noArtist.slice(0, 20).forEach(p => L.push('  ' + p));
L.push('\nSample of duplicates merged (first 15):'); dupes.slice(0, 15).forEach(p => L.push('  ' + p));
fs.writeFileSync(path.join(__dirname, 'catalogue-report.txt'), L.join('\n'));
console.log(L.slice(0, 5).join('\n') + '\n\nFull report: catalogue-report.txt   Catalogue: catalogue.json');

// Built-in defaults are at the top. OPTIONAL catalogue-rules.json adds to / overrides them, e.g.:
// { "minSeconds": 60, "hideArtists": ["Mozart","Tenacious D"], "hideFolders": ["Cheryls music/Kids"], "renameArtists": {"AC": "AC/DC"} }
