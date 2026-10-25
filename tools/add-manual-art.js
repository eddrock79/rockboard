// Adds your own album pictures. Put pictures in the art-manual folder (next to this script) named  Artist - Album.jpg  (or .png).
// Names are matched loosely (capitals, "The", punctuation don't matter). Run by Add New Music, or:  node add-manual-art.js
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'art-manual'), artDir = path.join(__dirname, 'art');
fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(artDir, { recursive: true });
const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
if (!files.length) { console.log('No pictures in art-manual (nothing to add).'); process.exit(0); }
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
const byKey = new Map();
for (const t of cat) if (t.coverId && t.album) byKey.set(norm(t.artist) + '|' + norm(t.album), t.coverId);
const sharp = require('sharp');
(async () => {
  let ok = 0; const bad = [];
  for (const f of files) {
    const base = path.parse(f).name, i = base.indexOf(' - ');
    const id = i > 0 ? byKey.get(norm(base.slice(0, i)) + '|' + norm(base.slice(i + 3))) : null;
    if (!id) { bad.push(f); continue; }
    try { await sharp(path.join(dir, f)).resize(256, 256, { fit: 'cover' }).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(artDir, id + '.jpg')); ok++; }
    catch (e) { bad.push(f + ' (could not read the picture)'); }
  }
  console.log('Manual artwork added: ' + ok + ' of ' + files.length);
  if (bad.length) { console.log('Not matched to an album (check the name is exactly  Artist - Album.jpg  as in missing-art.csv):'); bad.forEach(b => console.log('  ' + b)); }
})();
