// Banshee jukebox: music library scanner (READ ONLY - never changes your files).
// Usage:  node scan-library.js "\\eddrock79Nas\Music"
// Writes raw-scan.json (everything found) and library-report.txt (how good the tags are) next to this script.
const fs = require('fs');
const path = require('path');

const EXTS = new Set(['.mp3', '.m4a', '.wma', '.flac', '.ogg', '.wav']);
const root = process.argv[2];
if (!root) { console.error('Usage: node scan-library.js "<music folder>"'); process.exit(1); }

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { console.error('Cannot read', dir, e.message); return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXTS.has(path.extname(e.name).toLowerCase())) yield p;
  }
}

// "01 Nirvana - Smells Like Teen Spirit.mp3" -> { artist, title }
function fromFilename(file) {
  let base = path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
  base = base.replace(/^\(?\d{1,3}\)?[\s.\-_)]+(?=\D)/, '').trim(); // leading track number
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

const clean = s => String(s || '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  const mm = await import('music-metadata');
  const files = [...walk(root)];
  console.log('Found ' + files.length + ' audio files. Reading tags (a few minutes over the network)...');
  const out = [], bad = [];
  let done = 0;
  const started = Date.now();
  const queue = files.slice();
  async function worker() {
    while (queue.length) {
      const file = queue.pop();
      const fn = fromFilename(file);
      let tag = {}, duration = 0, codec = '';
      try {
        const meta = await mm.parseFile(file, { duration: true, skipCovers: true });
        tag = meta.common || {}; duration = meta.format.duration || 0; codec = meta.format.codec || meta.format.container || '';
      } catch (e) { bad.push(file + '  (' + clean(e.message).slice(0, 80) + ')'); }
      // Some tag readers split "AC/DC" into AC + DC, so stitch the pieces back together.
      const tArtist = clean((tag.artists && tag.artists.length > 1 ? tag.artists.join('/') : '') || tag.artist || tag.albumartist);
      const tTitle = clean(tag.title);
      const artist = tArtist || fn.artist;
      const title = tTitle || fn.title;
      const source = tArtist && tTitle ? 'tags' : (fn.artist ? 'filename' : 'unknown');
      out.push({
        id: out.length, path: path.relative(root, file).split(path.sep).join('/'),
        artist, title, album: clean(tag.album), year: tag.year || null, track: tag.track && tag.track.no || null,
        seconds: Math.round(duration), ext: path.extname(file).toLowerCase(), codec, source,
        filenameArtist: fn.artist, filenameTitle: fn.title,
      });
      if (++done % 500 === 0) console.log('  ' + done + ' / ' + files.length);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  out.sort((a, b) => a.path.localeCompare(b.path)); out.forEach((t, i) => t.id = i);

  fs.writeFileSync(path.join(__dirname, 'raw-scan.json'), JSON.stringify(out));

  // ---- report ----
  const L = [];
  const by = k => out.reduce((m, t) => (m[t[k]] = (m[t[k]] || 0) + 1, m), {});
  L.push('LIBRARY REPORT  (' + new Date().toLocaleString('en-GB') + ')');
  L.push('Folder: ' + root);
  L.push('Audio files: ' + out.length + '   Could not read: ' + bad.length + '   Took ' + Math.round((Date.now() - started) / 1000) + 's');
  L.push('Total playing time: ' + Math.round(out.reduce((s, t) => s + t.seconds, 0) / 3600) + ' hours');
  L.push('\nBy type: ' + JSON.stringify(by('ext')));
  L.push('Artist/title came from: ' + JSON.stringify(by('source')) + '   (tags = best, filename = guessed from the file name)');
  L.push('Tracks with an album tag: ' + out.filter(t => t.album).length);
  L.push('Tracks with no usable artist at all: ' + out.filter(t => !t.artist).length);
  const mismatch = out.filter(t => t.source === 'tags' && t.filenameArtist && norm(t.filenameArtist) !== norm(t.artist) && !norm(t.artist).includes(norm(t.filenameArtist)) && !norm(t.filenameArtist).includes(norm(t.artist)));
  L.push('Tag artist differs from the filename artist: ' + mismatch.length);
  const artists = {}; out.forEach(t => { if (t.artist) artists[t.artist] = (artists[t.artist] || 0) + 1; });
  const names = Object.keys(artists);
  L.push('Distinct artist names: ' + names.length);
  L.push('\nTOP 40 ARTISTS BY TRACKS:');
  names.sort((a, b) => artists[b] - artists[a]).slice(0, 40).forEach(n => L.push('  ' + n + '  (' + artists[n] + ')'));
  // near-duplicate artist spellings
  const groups = {}; names.forEach(n => { const k = norm(n).replace(/^the /, ''); (groups[k] = groups[k] || []).push(n); });
  const dupes = Object.values(groups).filter(g => g.length > 1);
  L.push('\nARTIST SPELLING VARIANTS (' + dupes.length + ', first 30):');
  dupes.slice(0, 30).forEach(g => L.push('  ' + g.join('  |  ')));
  const various = out.filter(t => /^(various|unknown|va$)/i.test(t.artist)).length;
  L.push('\nTracks filed as Various/Unknown artist: ' + various);
  L.push('\nSAMPLES where the tag and filename disagree (first 20):');
  mismatch.slice(0, 20).forEach(t => L.push('  tag: ' + t.artist + ' - ' + t.title + '   |   file: ' + t.path));
  L.push('\nSAMPLES with no tags (first 20):');
  out.filter(t => t.source !== 'tags').slice(0, 20).forEach(t => L.push('  ' + t.path));
  const dur = out.filter(t => t.seconds && (t.seconds < 45 || t.seconds > 900));
  L.push('\nVery short (<45s) or very long (>15 min) tracks: ' + dur.length);
  dur.slice(0, 15).forEach(t => L.push('  ' + t.seconds + 's  ' + t.path));
  if (bad.length) { L.push('\nFILES THAT COULD NOT BE READ (first 30):'); bad.slice(0, 30).forEach(b => L.push('  ' + b)); }
  fs.writeFileSync(path.join(__dirname, 'library-report.txt'), L.join('\n'));
  console.log('\nDone. Next run:  node build-catalogue.js');
})();
