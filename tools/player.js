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
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
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
    const r = await api('/player/catalogue', { reset: i === 0, rows: rows.slice(i, i + 500) });
    total = r.total; console.log('  ' + Math.min(i + 500, rows.length) + ' / ' + rows.length);
  }
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
    const items = files.slice(i, i + 40).map(f => ({ id: f.slice(0, 10), data: fs.readFileSync(path.join(dir, f)).toString('base64') }));
    total = (await api('/player/covers', { items, reset: i === 0 })).total; // first batch clears old covers
    console.log('  ' + Math.min(i + 40, files.length) + ' / ' + files.length);
  }
  console.log('Done. The jukebox now holds ' + total + ' covers.');
}

// ── mpv control over its IPC pipe ────────────────────────────
const ipcName = process.platform === 'win32' ? '\\\\.\\pipe\\banshee-mpv' : path.join(os.tmpdir(), 'banshee-mpv.sock');
class Mpv {
  constructor(file) {
    this.file = file; this.buf = ''; this.pending = new Map(); this.n = 0; this.exited = false; this.sock = null;
    const cmd = cfg.mpvPath || 'mpv';
    const args = [...(cfg.mpvArgs || []), '--no-video', '--no-terminal', '--audio-display=no', '--ytdl=no', '--idle=no',
      '--input-ipc-server=' + ipcName, ...(cfg.mpvExtra || []), file];
    this.proc = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    this.proc.on('error', e => { log('Could not start mpv:', e.message); this.exited = true; this.code = -1; });
    this.done = new Promise(res => this.proc.on('exit', code => { this.exited = true; this.code = code; try { this.sock && this.sock.destroy(); } catch (e) {} res(code); }));
  }
  async connect() {
    for (let i = 0; i < 40 && !this.exited; i++) {
      try {
        await new Promise((res, rej) => {
          const s = net.connect(ipcName); s.once('connect', () => { this.sock = s; res(); }); s.once('error', rej);
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
function pickHouse() {
  if (!catalogue.length) return null;
  for (let i = 0; i < 30; i++) {
    const t = catalogue[Math.floor(Math.random() * catalogue.length)];
    if (!recent.includes(t.id)) { recent.push(t.id); if (recent.length > Math.min(300, catalogue.length >> 1)) recent.shift(); return { ...t, duration: t.seconds * 1000 }; }
  }
  return { ...catalogue[0], duration: catalogue[0].seconds * 1000 };
}

// ── play one track until it ends or is skipped ───────────────
async function playTrack(t, kind) {
  const file = path.join(cfg.musicRoot, ...String(t.path).split('/'));
  log((kind === 'request' ? 'REQUEST ' : 'house   ') + t.artist + ' - ' + (t.title || t.name));
  const m = new Mpv(file);
  const started = Date.now();
  let paused = false, skipped = false;
  const ok = await m.connect();
  const report = async () => {
    let p = ok ? await m.pos() : null; if (p === null) p = Date.now() - started;
    try {
      const r = await api('/player/report', { id: t.id, progress: p, playing: !paused, kind });
      for (const c of r.cmds || []) {
        if (c === 'skip') { skipped = true; log('Skipped by staff'); m.kill(); }
        else if (c === 'pause') { paused = true; await m.pause(true); }
        else if (c === 'play') { paused = false; await m.pause(false); }
      }
    } catch (e) { /* worker unreachable: keep playing */ }
  };
  await report();
  const timer = setInterval(() => { if (!m.exited) report(); }, 2000);
  await m.done; clearInterval(timer);
  if (!skipped && Date.now() - started < 3000) { log('  could not play that file (is the NAS reachable? is mpv installed?)'); await sleep(2000); }
}

async function run() {
  loadCatalogue();
  log('Player started. Worker: ' + W);
  for (;;) {
    let t = null, kind = 'request';
    try { t = (await api('/player/next')).track; } catch (e) { log('Worker not reachable (' + e.message + '). Playing house music.'); }
    if (!t) { t = pickHouse(); kind = 'house'; }
    if (!t) { log('Nothing to play yet. Run:  node player.js upload'); await sleep(5000); continue; }
    await playTrack(t, kind);
  }
}

(process.argv[2] === 'upload' ? upload() : process.argv[2] === 'upload-art' ? uploadArt() : run()).catch(e => { console.error(e); process.exit(1); });
