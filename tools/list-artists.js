// Makes artists-review.xlsx: one row per artist in your jukebox catalogue, so you can mark the ones that should NOT be on the jukebox.
//   node list-artists.js          (after Add New Music has scanned the library)
// In Excel: put an X in the "Hide?" column for every artist to remove, save, close, then run:  node apply-artist-review.js
// Nothing on your NAS is ever changed or deleted: hiding only removes an artist from the jukebox's search.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));
let genreOf = new Map();
try { for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-scan.json'), 'utf8'))) if (r.genre) genreOf.set(r.path, r.genre); } catch (e) {}
let rules = {}; try { rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue-rules.json'), 'utf8').replace(/^﻿/, '')); } catch (e) {}
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '').replace(/ and /g, ' ');
const hidden = new Set((rules.hideArtists || []).map(norm));
const by = new Map();
for (const t of cat) {
  const a = by.get(t.artist) || { artist: t.artist, tracks: 0, secs: 0, albums: new Set(), genres: {}, folders: {}, titles: [] };
  a.tracks++; a.secs += t.seconds || 0; if (t.album) a.albums.add(t.album);
  const g = genreOf.get(t.path); if (g) a.genres[g] = (a.genres[g] || 0) + 1;
  const f = t.path.split('/').slice(0, -1).join('/'); a.folders[f] = (a.folders[f] || 0) + 1;
  if (a.titles.length < 3) a.titles.push(t.title);
  by.set(t.artist, a);
}
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]).join(' ; ');
const rows = [...by.values()].sort((a, b) => b.tracks - a.tracks);
const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Artists');
ws.columns = [{ header: 'Hide?', key: 'hide', width: 8 }, { header: 'Artist', key: 'artist', width: 32 }, { header: 'Tracks', key: 'tracks', width: 8 }, { header: 'Albums', key: 'albums', width: 8 }, { header: 'Avg length (min)', key: 'avg', width: 15 }, { header: 'Genre tag', key: 'genre', width: 24 }, { header: 'Main folder', key: 'folder', width: 40 }, { header: 'Sample titles', key: 'titles', width: 50 }];
for (const a of rows) ws.addRow({ hide: hidden.has(norm(a.artist)) ? 'X' : '', artist: a.artist, tracks: a.tracks, albums: a.albums.size, avg: Math.round(a.secs / a.tracks / 6) / 10, genre: top(a.genres), folder: top(a.folders).split(' ; ')[0], titles: a.titles.join(' | ') });
ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = 'A1:H1';
const out = path.join(__dirname, 'artists-review.xlsx');
wb.xlsx.writeFile(out).then(() => console.log(rows.length + ' artists written to ' + out + (genreOf.size ? '' : '\n(No genre tags yet: run Add New Music first to rescan, then this again, for a Genre column.)')));
