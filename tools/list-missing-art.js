// Lists albums that have no artwork on the jukebox. Writes missing-art.csv (opens in Excel) and prints the top ones.
//   node list-missing-art.js
// To fix one: save a picture into the art-manual folder named exactly  Artist - Album.jpg  (the CSV has a ready-made name), then run Add New Music.
const fs = require('fs');
const path = require('path');
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));
const artDir = path.join(__dirname, 'art');
const have = f => fs.existsSync(path.join(artDir, f + '.jpg'));
const groups = new Map();
for (const t of cat) {
  if (!t.coverId || have(t.coverId)) continue;
  const g = groups.get(t.coverId) || { artist: t.artist, album: t.album, folder: path.posix.dirname(t.path), tracks: 0 };
  g.tracks++; groups.set(t.coverId, g);
}
const noAlbum = cat.filter(t => !t.coverId).length;
const rows = [...groups.values()].sort((a, b) => b.tracks - a.tracks || a.artist.localeCompare(b.artist));
const safe = s => String(s).replace(/[<>:"\/\\|?*]+/g, '').trim();
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const lines = ['Artist,Album,Tracks,Folder,Save the picture as'];
for (const r of rows) lines.push([q(r.artist), q(r.album), r.tracks, q(r.folder), q(safe(r.artist) + ' - ' + safe(r.album) + '.jpg')].join(','));
fs.writeFileSync(path.join(__dirname, 'missing-art.csv'), '﻿' + lines.join('\r\n'));
console.log('Albums with no artwork: ' + rows.length + '   (plus ' + noAlbum + ' tracks with no album name, which can never show artwork)');
rows.slice(0, 25).forEach(r => console.log('  ' + r.artist + ' - ' + r.album + '  (' + r.tracks + ' tracks)'));
console.log('\nFull list: ' + path.join(__dirname, 'missing-art.csv'));
