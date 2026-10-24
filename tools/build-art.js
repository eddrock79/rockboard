// Banshee jukebox: pull album artwork out of your music files and shrink it to small thumbnails. READ ONLY on your music.
// Usage:  node build-art.js "\\eddrock79Nas\Music"      (after build-catalogue.js; a few minutes)
// Writes art/<id>.jpg (about 15 KB each) and art-report.txt. Then:  node player.js upload-art
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('Usage: node build-art.js "<music folder>"'); process.exit(1); }
const catFile = path.join(__dirname, 'catalogue.json');
if (!fs.existsSync(catFile)) { console.error('Run build-catalogue.js first.'); process.exit(1); }
const outDir = path.join(__dirname, 'art');
fs.mkdirSync(outDir, { recursive: true });

const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
const groups = new Map(); // coverId -> tracks (first few are tried)
for (const t of cat) { if (!t.coverId) continue; const g = groups.get(t.coverId) || []; if (g.length < 4) g.push(t); groups.set(t.coverId, g); }

// Which artists / albums live in each folder (a folder picture is only trusted if it can only mean one artist or one album)
const dirInfo = new Map();
for (const t of cat) {
  const d = path.posix.dirname(t.path), e = dirInfo.get(d) || { artists: new Set(), albums: new Set() };
  e.artists.add(t.artistId); e.albums.add((t.album || '').toLowerCase()); dirInfo.set(d, e);
}
const folderTrusted = d => { const e = dirInfo.get(d); return !!e && (e.artists.size === 1 || e.albums.size === 1); };
const crypto = require('crypto');
const FOLDER_ART = ['cover', 'folder', 'front', 'albumart', 'album', 'artwork'];
function folderImage(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f));
    const pick = files.find(f => FOLDER_ART.includes(path.parse(f).name.toLowerCase())) || (files.length === 1 ? files[0] : null);
    return pick ? path.join(dir, pick) : null;
  } catch (e) { return null; }
}

(async () => {
  const mm = await import('music-metadata');
  const sharp = require('sharp');
  const ids = [...groups.keys()];
  console.log('Albums to look at: ' + ids.length);
  let done = 0, fromTag = 0, fromFolder = 0, none = 0, failed = 0, skipped = 0, untrusted = 0;
  const missing = [], meta = new Map(); // coverId -> { how, hash, artistId, dir }
  const queue = ids.slice();
  async function worker() {
    while (queue.length) {
      const id = queue.pop();
      const target = path.join(outDir, id + '.jpg');
      if (fs.existsSync(target)) { skipped++; if (++done % 200 === 0) console.log('  ' + done + ' / ' + ids.length); continue; }
      const tracks = groups.get(id);
      let buf = null, how = '';
      for (const t of tracks) {
        try {
          const meta = await mm.parseFile(path.join(root, ...t.path.split('/')), { duration: false, skipCovers: false });
          const pic = meta.common.picture && meta.common.picture[0];
          if (pic && pic.data && pic.data.length > 500) { buf = Buffer.from(pic.data); how = 'tag'; break; }
        } catch (e) { /* try the next track */ }
      }
      if (!buf) {
        const dir = path.join(root, ...path.posix.dirname(tracks[0].path).split('/'));
        const rel = path.posix.dirname(tracks[0].path);
        if (rel !== '.' && !folderTrusted(rel)) untrusted++;
        else if (rel !== '.') {
          const f = folderImage(dir);
          if (f) { try { buf = fs.readFileSync(f); how = 'folder'; } catch (e) {} }
        }
      }
      if (!buf) { none++; missing.push(tracks[0].artist + ' - ' + (tracks[0].album || '?')); }
      else {
        try {
          await sharp(buf).resize(256, 256, { fit: 'cover' }).jpeg({ quality: 72, mozjpeg: true }).toFile(target);
          if (how === 'tag') fromTag++; else fromFolder++;
          meta.set(id, { how, hash: crypto.createHash('sha1').update(buf).digest('hex'), artistId: tracks[0].artistId, dir: path.posix.dirname(tracks[0].path) });
        } catch (e) { failed++; }
      }
      if (++done % 200 === 0) console.log('  ' + done + ' / ' + ids.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  // A folder picture that turns up for 3 or more different artists is a stray image in a mixed folder: remove it.
  const byHash = new Map();
  for (const [id, m] of meta) { const e = byHash.get(m.hash) || new Set(); e.add(m.artistId); byHash.set(m.hash, e); }
  const droppedShared = [];
  for (const [id, m] of meta) {
    if (m.how === 'folder' && byHash.get(m.hash).size >= 3) { try { fs.unlinkSync(path.join(outDir, id + '.jpg')); } catch (e) {} droppedShared.push(m.dir + '  (' + byHash.get(m.hash).size + ' artists)'); fromFolder--; }
  }
  const have = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg')).length;
  const covered = cat.filter(t => t.coverId && fs.existsSync(path.join(outDir, t.coverId + '.jpg'))).length;
  const L = ['ARTWORK REPORT', 'Albums: ' + ids.length + '   artwork found: ' + have + ' (from tags ' + fromTag + ', from folder images ' + fromFolder + ', already done ' + skipped + ')',
    'Folder pictures not trusted (mixed folder): ' + untrusted + '   dropped because one picture appeared for 3+ artists: ' + droppedShared.length,
    'No artwork: ' + none + '   could not convert: ' + failed,
    'Tracks that will show artwork: ' + covered + ' of ' + cat.length + ' (' + Math.round(covered / cat.length * 100) + '%)',
    '\nDropped shared folder pictures:', ...[...new Set(droppedShared)].slice(0, 30).map(m => '  ' + m),
    '\nAlbums with no artwork (first 40):', ...missing.slice(0, 40).map(m => '  ' + m)];
  fs.writeFileSync(path.join(__dirname, 'art-report.txt'), L.join('\n'));
  console.log('\n' + L.slice(0, 4).join('\n') + '\n\nNext:  node player.js upload-art');
})();
