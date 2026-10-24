// Banshee jukebox: fill in missing album artwork from Deezer's free public search (no account or key needed).
// It only fetches pictures for albums that have none yet, by searching artist + album name. Your music files are not touched.
//   node fetch-art-online.js --sample 40     try 40 albums and print what it matched (nothing is saved)
//   node fetch-art-online.js                 do all missing albums (about 5 minutes) and save thumbnails to art/
// Then:  node player.js upload-art
const fs = require('fs');
const path = require('path');

const BASE = process.env.DEEZER_BASE || 'https://api.deezer.com';
const sampleIdx = process.argv.indexOf('--sample');
const SAMPLE = sampleIdx > 0 ? Number(process.argv[sampleIdx + 1]) || 40 : 0;
const artDir = path.join(__dirname, 'art');
fs.mkdirSync(artDir, { recursive: true });
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const artistKey = s => norm(s).replace(/^the /, '');
const cleanAlbum = s => norm(String(s || '').replace(/[\(\[][^\)\]]*(remaster|deluxe|edition|disc|cd\s*\d|bonus|expanded|anniversary)[^\)\]]*[\)\]]/gi, ' ').replace(/\b(disc|cd)\s*\d+\b/gi, ' '));
const toks = s => new Set(cleanAlbum(s).split(' ').filter(w => w.length > 1));
function similarity(a, b) {
  const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { requests: 0, errors: 0, lastError: '', empty: 0 };
const PACE = 220; // ms between requests: stays well under the free limit

// one wanted album per coverId that has no picture yet
const wanted = new Map();
for (const t of cat) {
  if (!t.coverId || !t.album || fs.existsSync(path.join(artDir, t.coverId + '.jpg'))) continue;
  const w = wanted.get(t.coverId) || { id: t.coverId, artist: t.artist, album: t.album, titles: [] };
  if (w.titles.length < 3) w.titles.push(t.title);
  wanted.set(t.coverId, w);
}
// Album tags like "All albums", "VH1 100 Greatest...", "Dad's Jukebox Disc 3" are not real albums: search by song for those.
const junkAlbum = /^(unknown|untitled|various|greatest hits|best of|the best of|collection|compilation|soundtrack|singles|hits)$|all albums|greatest|jukebox|vh1|vol\.? ?\d|volume|disc ?\d|cd ?\d|halloween|now that|\bhits\b|best of/i;

async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    stats.requests++;
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(12000) }); } catch (e) { stats.errors++; stats.lastError = 'network: ' + e.message; await sleep(2000); continue; }
    if (r.status === 429) { stats.errors++; stats.lastError = 'HTTP 429 (too many requests)'; await sleep(4000); continue; }
    if (!r.ok) { stats.errors++; stats.lastError = 'HTTP ' + r.status; return null; }
    const j = await r.json().catch(() => null);
    if (j && j.error) { stats.errors++; stats.lastError = JSON.stringify(j.error).slice(0, 120); await sleep(4000); continue; } // quota etc: wait and retry
    if (j && (!j.data || !j.data.length)) stats.empty++;
    return j;
  }
  return null;
}
const stripParens = s => norm(String(s || '').replace(/[\(\[][^\)\]]*[\)\]]/g, ' '));
async function findBySong(w) {
  for (const title of w.titles) {
    const q = `${BASE}/search/track?q=${encodeURIComponent(`artist:"${w.artist}" track:"${title}"`)}&limit=8`;
    const j = await getJson(q); await sleep(PACE);
    const hit = ((j && j.data) || []).find(c => c.artist && artistKey(c.artist.name) === artistKey(w.artist) && c.album && stripParens(c.title) === stripParens(title));
    if (hit) return { c: { title: hit.album.title, artist: hit.artist, cover_big: hit.album.cover_big, cover_medium: hit.album.cover_medium }, s: 1, by: 'song "' + title + '"' };
  }
  return null;
}
async function findByAlbum(w) {
  const q1 = `${BASE}/search/album?q=${encodeURIComponent(`artist:"${w.artist}" album:"${w.album}"`)}&limit=6`;
  const q2 = `${BASE}/search/album?q=${encodeURIComponent(w.artist + ' ' + w.album)}&limit=6`;
  for (const url of [q1, q2]) {
    const j = await getJson(url); await sleep(PACE);
    const hits = ((j && j.data) || []).filter(c => artistKey(c.artist && c.artist.name) === artistKey(w.artist))
      .map(c => ({ c, s: similarity(c.title, w.album) })).sort((a, b) => b.s - a.s);
    if (hits.length && hits[0].s >= 0.6) return { ...hits[0], by: 'album' };
  }
  return null;
}
async function find(w) {
  const real = !junkAlbum.test(w.album.trim());
  return (real && (await findByAlbum(w))) || (await findBySong(w));
}

(async () => {
  const sharp = SAMPLE ? null : require('sharp');
  let list = [...wanted.values()];
  if (SAMPLE) { const t0 = await getJson(BASE + '/search/track?q=' + encodeURIComponent('artist:"Slayer" track:"Raining Blood"') + '&limit=2'); console.log('Connection test: ' + (t0 && t0.data && t0.data.length ? 'OK (got ' + t0.data[0].artist.name + ' - ' + t0.data[0].title + ')' : 'FAILED ' + (stats.lastError || 'no results'))); }
  console.log('Albums without artwork: ' + wanted.size + '   worth looking up: ' + list.length);
  if (SAMPLE) { list = list.sort(() => Math.random() - 0.5).slice(0, SAMPLE); console.log('SAMPLE of ' + list.length + ' (nothing will be saved):\n'); }
  let ok = 0, miss = 0, i = 0; const log = [];
  for (const w of list) {
    let m = null;
    try { m = await find(w); } catch (e) { /* network hiccup: counts as a miss */ }
    if (!m) { miss++; log.push('MISS   ' + w.artist + ' - ' + w.album); if (SAMPLE) console.log('MISS   ' + w.artist + ' - ' + w.album); }
    else {
      const line = 'OK     ' + w.artist + ' - ' + w.album + '   ==>   ' + m.c.artist.name + ' - ' + m.c.title + '  [' + m.by + ']';
      log.push(line); if (SAMPLE) console.log(line);
      if (!SAMPLE) {
        try {
          const img = await fetch(m.c.cover_big || m.c.cover_medium, { signal: AbortSignal.timeout(15000) });
          if (img.ok) { await sharp(Buffer.from(await img.arrayBuffer())).resize(256, 256, { fit: 'cover' }).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(artDir, w.id + '.jpg')); ok++; }
          else miss++;
          await sleep(100);
        } catch (e) { miss++; }
      } else ok++;
    }
    if (!SAMPLE && ++i % 100 === 0) console.log('  ' + i + ' / ' + list.length);
  }
  if (!SAMPLE) fs.writeFileSync(path.join(__dirname, 'art-online-log.txt'), log.join('\n'));
  console.log('\nRequests made: ' + stats.requests + '   refused/failed: ' + stats.errors + '   searches with no results: ' + stats.empty + (stats.lastError ? '\nLast problem seen: ' + stats.lastError : ''));
  console.log((SAMPLE ? 'In this sample: ' : 'Done. ') + ok + ' found, ' + miss + ' not found.' + (SAMPLE ? '' : '  Log: art-online-log.txt\nNext:  node player.js upload-art'));
})();
