// Banshee jukebox: the PLAYER. Runs on the jukebox PC and plays MP3s from the NAS.
//   node player.js upload     send catalogue.json to the jukebox (run again whenever the library changes)
//   node player.js upload-art send album artwork (after build-art.js)
//   node player.js            play music (paid requests first, then house music), forever
// Needs mpv installed (winget install mpv) and player-config.json next to this file.
// It only READS your music files. Close it with Ctrl+C.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const cfgFile = path.join(__dirname, 'player-config.json');
if (!fs.existsSync(cfgFile)) { console.error('Missing player-config.json (copy player-config.example.json and fill it in).'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^\uFEFF/, ''));
const W = String(cfg.workerUrl || '').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB'), ...a);

async function api(p, body) {
  const r = await fetch(W + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-Key': cfg.playerKey },
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + (j.error || ''));
  return j;
}

// ── upload the catalogue ─────────────────────────────────────
async function upload() {
  const file = path.join(__dirname, 'catalogue.json');
  if (!fs.existsSync(file)) { console.error('Run build-catalogue.js first.'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('Uploading ' + rows.length + ' tracks...');
  let total = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const r = await api('/player/catalogue', { rows: rows.slice(i, i + 500) });
    total = r.total; console.log('  ' + Math.min(i + 500, rows.length) + ' / ' + rows.length);
  }
  const pr = await api('/player/catalogue', { prune: rows.map(r => r.id) }); // drop anything no longer in your library
  total = pr.total; if (pr.removed) console.log('  removed ' + pr.removed + ' tracks no longer in the catalogue');
  console.log('Done. The jukebox now has ' + total + ' tracks.');
}

// ── upload album artwork thumbnails ──────────────────────────
async function uploadArt() {
  const dir = path.join(__dirname, 'art');
  if (!fs.existsSync(dir)) { console.error('Run build-art.js first.'); process.exit(1); }
  const files = fs.readdirSync(dir).filter(f => /^[0-9a-f]{10}\.jpg$/.test(f));
  console.log('Uploading ' + files.length + ' album covers...');
  let total = 0;
  for (let i = 0; i < files.length; i += 40) {
    const items = files.slice(i, i + 40).map(f => { const b = fs.readFileSync(path.join(dir, f)); return { id: f.slice(0, 10), h: require('crypto').createHash('sha1').update(b).digest('hex'), data: b.toString('base64') }; });
    total = (await api('/player/covers', { items })).total;
    console.log('  ' + Math.min(i + 40, files.length) + ' / ' + files.length);
  }
  const pr = await api('/player/covers', { prune: files.map(f => f.slice(0, 10)) }); // drop covers you no longer have
  console.log('Done. Removed ' + pr.removed + ' old covers; the jukebox now holds ' + files.length + ' covers.');
}

// ── mpv control over its IPC pipe ────────────────────────────
const ipcBase = process.platform === 'win32' ? '\\\\.\\pipe\\banshee-mpv' : path.join(os.tmpdir(), 'banshee-mpv');
let mpvCount = 0;
class Mpv {
  constructor(file, volume = 100) {
    this.file = file; this.ipcName = ipcBase + '-' + process.pid + '-' + (++mpvCount) + (process.platform === 'win32' ? '' : '.sock'); this.buf = ''; this.pending = new Map(); this.n = 0; this.exited = false; this.sock = null;
    const cmd = cfg.mpvPath || 'mpv';
    const args = [...(cfg.mpvArgs || []), '--no-video', '--no-terminal', '--audio-display=no', '--ytdl=no', '--idle=no',
      '--input-ipc-server=' + this.ipcName, '--volume=' + volume, ...(cfg.mpvExtra || []), file];
    this.proc = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    this.proc.on('error', e => { log('Could not start mpv:', e.message); this.exited = true; this.code = -1; });
    this.done = new Promise(res => this.proc.on('exit', code => { this.exited = true; this.code = code; try { this.sock && this.sock.destroy(); } catch (e) {} res(code); }));
  }
  async connect() {
    for (let i = 0; i < 40 && !this.exited; i++) {
      try {
        await new Promise((res, rej) => {
          const s = net.connect(this.ipcName); s.once('connect', () => { this.sock = s; res(); }); s.once('error', rej);
        });
        this.sock.on('data', d => this.onData(d)); this.sock.on('error', () => {});
        return true;
      } catch (e) { await sleep(150); }
    }
    return false;
  }
  onData(d) {
    this.buf += d.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.request_id && this.pending.has(m.request_id)) { this.pending.get(m.request_id)(m); this.pending.delete(m.request_id); } } catch (e) {}
    }
  }
  cmd(...command) {
    return new Promise(res => {
      if (!this.sock || this.exited) return res(null);
      const id = ++this.n; this.pending.set(id, res);
      try { this.sock.write(JSON.stringify({ command, request_id: id }) + '\n'); } catch (e) { return res(null); }
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); res(null); } }, 1500);
    });
  }
  async pos() { const r = await this.cmd('get_property', 'time-pos'); return r && typeof r.data === 'number' ? Math.round(r.data * 1000) : null; }
  pause(v) { return this.cmd('set_property', 'pause', !!v); }
  volume(v) { return this.cmd('set_property', 'volume', Math.max(0, Math.min(100, Math.round(v)))); }
  kill() { try { this.proc.kill(); } catch (e) {} }
}

// ── house music (plays when nobody has paid for anything) ────
let catalogue = [];
function loadCatalogue() {
  const f = path.join(__dirname, 'catalogue.json');
  catalogue = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  const want = new Set((cfg.houseArtists || []).map(norm));
  let pool = want.size ? catalogue.filter(t => want.has(norm(t.artist))) : [];
  if (!pool.length) pool = catalogue.filter(t => t.seconds >= 120 && t.seconds <= 480);
  if (!pool.length) pool = catalogue;
  catalogue = pool;
  log('House music pool: ' + pool.length + ' tracks' + (want.size ? ' (' + want.size + ' chosen artists)' : ' (whole library)'));
}
const recent = [];
let catMtime = 0;
function pickHouse() {
  try { const m = fs.statSync(path.join(__dirname, 'catalogue.json')).mtimeMs; if (catMtime && m !== catMtime) { loadCatalogue(); } catMtime = m; } catch (e) {}
  if (!catalogue.length) return null;
  for (let i = 0; i < 30; i++) {
    const t = catalogue[Math.floor(Math.random() * catalogue.length)];
    if (!recent.includes(t.id)) { recent.push(t.id); if (recent.length > Math.min(300, catalogue.length >> 1)) recent.shift(); return { ...t, duration: t.seconds * 1000 }; }
  }
  return { ...catalogue[0], duration: catalogue[0].seconds * 1000 };
}

// ── playing, with a crossfade between songs ─────────────────
// The next song starts FADE seconds before the current one ends; one fades down while the other fades up.
// Set "crossfadeSeconds" in player-config.json (default 5, 0 = off). Very short tracks are not crossfaded.
const FADE_MS = Math.max(0, Number(cfg.crossfadeSeconds === undefined ? 5 : cfg.crossfadeSeconds) * 1000);

async function pickNext() {
  let t = null, kind = 'request';
  try { t = (await api('/player/next')).track; } catch (e) { log('Worker not reachable (' + e.message + '). Playing house music.'); }
  if (!t) { t = pickHouse(); kind = 'house'; }
  return t ? { t, kind } : null;
}
async function startDeck(p, volume) {
  const t = p.t, file = path.join(cfg.musicRoot, ...String(t.path).split('/'));
  log((p.kind === 'request' ? 'REQUEST ' : 'house   ') + t.artist + ' - ' + (t.title || t.name));
  const m = new Mpv(file, volume), ok = await m.connect();
  const d = { t, kind: p.kind, m, ok, started: Date.now(), dur: (t.seconds || (t.duration || 0) / 1000 || 0) * 1000 };
  if (ok) { const r = await m.cmd('get_property', 'duration'); if (r && typeof r.data === 'number' && r.data > 0) d.dur = r.data * 1000; }
  return d;
}

async function run() {
  loadCatalogue();
  log('Player started. Worker: ' + W + (FADE_MS ? '  Crossfade: ' + FADE_MS / 1000 + 's' : '  Crossfade: off'));
  let active = null, outgoing = null, fadeStart = 0, paused = false, lastRep = 0, pendingPick = null;
  const decks = () => [active, outgoing].filter(Boolean);
  const skip = () => { const d = outgoing || active; if (d) d.m.kill(); };
  const report = async () => {
    if (!active) return;
    let p = active.ok ? await active.m.pos() : null; if (p === null) p = Date.now() - active.started;
    try {
      const r = await api('/player/report', { id: active.t.id, progress: p, playing: !paused, kind: active.kind });
      for (const c of r.cmds || []) {
        if (c === 'skip') { log('Skipped by staff'); skip(); }
        else if (c === 'pause') { paused = true; for (const d of decks()) await d.m.pause(true); }
        else if (c === 'play') { paused = false; for (const d of decks()) await d.m.pause(false); }
      }
    } catch (e) { /* worker unreachable: keep playing */ }
  };
  for (;;) {
    if (!active) {
      const p = pendingPick || await pickNext(); pendingPick = null;
      if (!p) { log('Nothing to play yet. Run:  node player.js upload'); await sleep(5000); continue; }
      active = await startDeck(p, 100);
      if (paused) await active.m.pause(true);
      lastRep = Date.now(); await report();
      continue;
    }
    await sleep(250);
    const now = Date.now();
    // the old song has finished fading (or was skipped): the new one takes over at full volume
    if (outgoing && (outgoing.m.exited || now - fadeStart >= FADE_MS)) {
      outgoing.m.kill(); outgoing = null;
      if (active && !active.m.exited) await active.m.volume(100);
    }
    // the current song has ended
    if (active.m.exited) {
      if (!outgoing && now - active.started < 3000) { log('  could not play that file (is the NAS reachable? is mpv installed?)'); await sleep(2000); }
      active = outgoing; outgoing = null;
      if (active) { await active.m.volume(100); lastRep = 0; }
      continue;
    }
    if (now - lastRep > 2000) { lastRep = now; await report(); }
    if (outgoing) { // mid-crossfade: equal-power curves so the blend doesn't dip
      const x = Math.min(1, (now - fadeStart) / FADE_MS);
      await outgoing.m.volume(100 * Math.cos(x * Math.PI / 2)); await active.m.volume(100 * Math.sin(x * Math.PI / 2));
      continue;
    }
    // time to start the next song underneath?
    if (FADE_MS && active.ok && !paused && active.dur > FADE_MS * 3) {
      const pos = await active.m.pos();
      if (pos !== null && active.dur - pos <= FADE_MS + 1200) {
        const p = pendingPick || await pickNext(); pendingPick = null;
        if (p) {
          const nd = await startDeck(p, 0);
          if (nd.ok) { outgoing = active; active = nd; fadeStart = Date.now(); lastRep = Date.now(); await report(); }
          else { nd.m.kill(); pendingPick = p; } // couldn't start it underneath: play it normally when this one ends
        }
      }
    }
  }
}

(process.argv[2] === 'upload' ? upload() : process.argv[2] === 'upload-art' ? uploadArt() : run()).catch(e => { console.error(e); process.exit(1); });
