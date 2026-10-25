// READ-ONLY. Pulls the Black Rose jukebox's play history out of its Firebase database and builds an Excel sheet,
// matched against your own music library so you can see what's popular and what you're missing.
// It never writes, changes or deletes anything at the Black Rose. It only reads (the same way the board itself does).
//   node export-blackrose.js          (needs catalogue.json in this folder, and: npm install exceljs)
const fs = require('fs');
const path = require('path');

const CONFIG_URL = process.env.BR_CONFIG_URL || 'https://raw.githubusercontent.com/eddrock79/rockboardBR/main/config.js';
const BASE = process.env.FIRESTORE_BASE || 'https://firestore.googleapis.com';
const MAX_DOCS = process.argv.includes('--force') ? 1e9 : 30000; // safety: stop if a collection is huge (the free daily read allowance is shared with the live board)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const artistKey = s => norm(s).replace(/^the /, '').replace(/ and /g, ' ');
const cleanTitle = s => norm(String(s || '').replace(/\s*[\(\[][^\)\]]*(remaster|live|version|mix|edit|radio|mono|stereo)[^\)\]]*[\)\]]/gi, '').replace(/\s*-\s*(\d{4}\s*)?(remaster(ed)?|live|radio edit|single version).*$/i, ''));
const val = f => f == null ? undefined : f.stringValue ?? (f.integerValue != null ? Number(f.integerValue) : f.doubleValue != null ? f.doubleValue : f.timestampValue ? Date.parse(f.timestampValue) : undefined);

async function main() {
  const cfgText = await (await fetch(CONFIG_URL, { signal: AbortSignal.timeout(15000) })).text();
  const apiKey = (cfgText.match(/apiKey:\s*"([^"]+)"/) || [])[1], project = (cfgText.match(/projectId:\s*"([^"]+)"/) || [])[1];
  if (!apiKey || !project) throw new Error('Could not read the Black Rose database settings.');
  const doc = `${BASE}/v1/projects/${project}/databases/(default)/documents`;

  async function count(coll) {
    const r = await fetch(`${doc}:runAggregationQuery?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: coll }] }, aggregations: [{ alias: 'n', count: {} }] } }), signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (!r.ok) throw new Error(coll + ': ' + (j.error && j.error.message || r.status));
    return Number(j[0].result.aggregateFields.n.integerValue);
  }
  async function readAll(coll, fields) {
    const out = []; let tok = '';
    do {
      const url = `${doc}/${coll}?pageSize=300&key=${apiKey}` + fields.map(f => '&mask.fieldPaths=' + f).join('') + (tok ? '&pageToken=' + encodeURIComponent(tok) : '');
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); const j = await r.json();
      if (!r.ok) throw new Error(coll + ': ' + (j.error && j.error.message || r.status));
      for (const d of j.documents || []) { const o = {}; for (const k in d.fields || {}) o[k] = val(d.fields[k]); out.push(o); }
      tok = j.nextPageToken || ''; process.stdout.write('\r  ' + coll + ': ' + out.length + ' read'); await sleep(150);
    } while (tok);
    console.log(''); return out;
  }

  console.log('Counting (read-only)...');
  const nAll = await count('br_alltime'), nPlayed = await count('br_played');
  console.log(`  all-time leaderboard: ${nAll} songs     play history: ${nPlayed} entries`);
  if (nAll > MAX_DOCS || nPlayed > MAX_DOCS) throw new Error('That is a lot of records. Run again with --force if you are sure.');
  const alltime = await readAll('br_alltime', ['title', 'artist', 'plays', 'addedAt']);
  const played = await readAll('br_played', ['title', 'artist', 'playedAt']);

  // combine by artist + cleaned title
  const songs = new Map();
  const get = (artist, title) => {
    const k = artistKey(artist) + '|' + cleanTitle(title);
    if (!songs.has(k)) songs.set(k, { artist: String(artist || '').trim(), title: String(title || '').trim(), allTime: 0, history: 0, last: 0 });
    return songs.get(k);
  };
  for (const a of alltime) if (a.title && a.artist) get(a.artist, a.title).allTime += a.plays || 1;
  for (const p of played) if (p.title && p.artist) { const s = get(p.artist, p.title); s.history++; s.last = Math.max(s.last, p.playedAt || 0); }

  // match against your library
  const catFile = path.join(__dirname, 'catalogue.json');
  const cat = fs.existsSync(catFile) ? JSON.parse(fs.readFileSync(catFile, 'utf8')) : [];
  const haveSong = new Map(), haveArtist = new Map();
  for (const t of cat) { haveSong.set(artistKey(t.artist) + '|' + cleanTitle(t.title), t); haveArtist.set(artistKey(t.artist), (haveArtist.get(artistKey(t.artist)) || 0) + 1); }

  const rows = [...songs.entries()].map(([k, s]) => {
    const plays = Math.max(s.allTime, s.history), hit = haveSong.get(k);
    return { ...s, plays, inLib: cat.length ? (hit ? 'Yes' : 'No') : '?', artistInLib: cat.length ? (haveArtist.has(k.split('|')[0]) ? 'Yes' : 'No') : '?', album: hit ? hit.album : '', k };
  }).sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist));

  const artists = new Map();
  for (const r of rows) { const ak = artistKey(r.artist); const a = artists.get(ak) || { artist: r.artist, songs: 0, plays: 0, inLib: haveArtist.get(ak) || 0 }; a.songs++; a.plays += r.plays; artists.set(ak, a); }
  const albums = new Map();
  for (const r of rows) if (r.inLib === 'Yes' && r.album) { const k = artistKey(r.artist) + '|' + norm(r.album); const a = albums.get(k) || { artist: r.artist, album: r.album, songs: 0, plays: 0 }; a.songs++; a.plays += r.plays; albums.set(k, a); }

  const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook();
  const sheet = (name, cols, data) => { const ws = wb.addWorksheet(name); ws.columns = cols; ws.addRows(data); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: String.fromCharCode(64 + cols.length) + '1' }; return ws; };
  const fmt = t => t ? new Date(t).toLocaleDateString('en-GB') : '';
  sheet('Songs', [{ header: 'Artist', key: 'artist', width: 28 }, { header: 'Song', key: 'title', width: 38 }, { header: 'Plays (best figure)', key: 'plays', width: 16 }, { header: 'All-time board', key: 'allTime', width: 14 }, { header: 'Play history', key: 'history', width: 13 }, { header: 'Last played', key: 'last', width: 12 }, { header: 'In your library?', key: 'inLib', width: 15 }, { header: 'Artist in library?', key: 'artistInLib', width: 17 }, { header: 'Album (your copy)', key: 'album', width: 30 }], rows.map(r => ({ ...r, last: fmt(r.last) })));
  sheet('Artists', [{ header: 'Artist', key: 'artist', width: 30 }, { header: 'Different songs', key: 'songs', width: 15 }, { header: 'Total plays', key: 'plays', width: 12 }, { header: 'Tracks in your library', key: 'inLib', width: 22 }], [...artists.values()].sort((a, b) => b.plays - a.plays));
  if (cat.length) {
    sheet('Albums in library', [{ header: 'Artist', key: 'artist', width: 28 }, { header: 'Album', key: 'album', width: 40 }, { header: 'Popular songs on it', key: 'songs', width: 18 }, { header: 'Their total plays', key: 'plays', width: 16 }], [...albums.values()].sort((a, b) => b.plays - a.plays));
    sheet('Missing from library', [{ header: 'Artist', key: 'artist', width: 28 }, { header: 'Song', key: 'title', width: 38 }, { header: 'Plays', key: 'plays', width: 10 }, { header: 'Artist in library?', key: 'artistInLib', width: 17 }], rows.filter(r => r.inLib === 'No'));
  }
  const out = path.join(__dirname, 'blackrose-requests.xlsx'); await wb.xlsx.writeFile(out);
  console.log(`\nDone: ${rows.length} different songs, ${artists.size} artists.` + (cat.length ? ` In your library: ${rows.filter(r => r.inLib === 'Yes').length} songs.` : ''));
  console.log('Top 10:'); rows.slice(0, 10).forEach((r, i) => console.log(`  ${i + 1}. ${r.artist} - ${r.title} (${r.plays})`));
  console.log('\nSaved: ' + out);
}
main().catch(e => { console.error('\nStopped: ' + e.message); process.exit(1); });
