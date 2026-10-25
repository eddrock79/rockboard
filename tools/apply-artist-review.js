// Reads artists-review.xlsx and hides every artist marked in the "Hide?" column (anything non-blank: X, yes, 1...).
// It writes catalogue-rules.json only. Your music files are never touched. Then run Add New Music to update the jukebox.
//   node apply-artist-review.js
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const rulesFile = path.join(__dirname, 'catalogue-rules.json');
(async () => {
  const file = path.join(__dirname, 'artists-review.xlsx');
  if (!fs.existsSync(file)) { console.error('Run list-artists.js first.'); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '').replace(/ and /g, ' ');
  const inSheet = new Set(), marked = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const hide = String(row.getCell(1).value || '').trim(), artist = String(row.getCell(2).value || '').trim();
    if (!artist) return;
    inSheet.add(norm(artist)); if (hide) marked.push(artist);
  });
  let rules = {}; try { rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8').replace(/^﻿/, '')); } catch (e) {}
  const keep = (rules.hideArtists || []).filter(a => !inSheet.has(norm(a))); // earlier hides for artists not on the sheet stay
  rules.hideArtists = [...keep, ...marked];
  fs.writeFileSync(rulesFile, JSON.stringify(rules, null, 2));
  console.log(marked.length + ' artists marked to hide (' + rules.hideArtists.length + ' in total). Saved catalogue-rules.json.');
  console.log('Now run Add New Music to update the jukebox.');
})();
