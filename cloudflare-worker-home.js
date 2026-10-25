// ============================================================
//  EDD & CHERYL JUKEBOX — HOME EDITION (Cloudflare Worker)
//  Free, unlimited plays (no payments). Each phone can have up to
//  MAX_QUEUED songs waiting at once. Based on the local-music edition,
//  but the music is your own MP3 library, played by a small player
//  program on the jukebox PC (tools/player.js) reading from the NAS.
//  The worker never touches your files: it only holds a searchable
//  catalogue (artist, title, length) and the queue.
// ============================================================
import { DurableObject } from 'cloudflare:workers';

const TIERS = {
  tier1: { amountPence: 100, plays: 2, label: '£1' },
  tier2: { amountPence: 200, plays: 5, label: '£2' },
};
const VENUE = 'home';
const MAX_QUEUED = 500; // effectively unlimited at home
const SESSION_WINDOW_MS = 2 * 60 * 60 * 1000;
const TRACK_URI = /^local:[0-9a-f]{10}$/;
const PLAYER_STALE_MS = 30000; // no report for this long = player offline

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const artistKey = s => norm(s).replace(/^the /, '');
const tokens = q => norm(q).split(' ').filter(Boolean).slice(0, 6);

function shape(r) {
  return {
    uri: 'local:' + r.id, id: r.id, name: r.title, artist: r.artist,
    artists: [{ id: r.artist_id, name: r.artist }],
    image: r.has_cover ? '/cover/' + r.cover_id : '', duration: Math.round((r.seconds || 0) * 1000), explicit: false,
  };
}

// ── LEDGER (Durable Object, SQLite-backed) ───────────────────
export class Ledger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY, path TEXT, artist TEXT, artist_id TEXT, artist_key TEXT,
      title TEXT, title_key TEXT, all_key TEXT, album TEXT, seconds INTEGER)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist_id)');
    try { this.sql.exec('ALTER TABLE tracks ADD COLUMN cover_id TEXT'); } catch (e) { /* already there */ }
    try { this.sql.exec('ALTER TABLE tracks ADD COLUMN album_key TEXT'); } catch (e) { /* already there */ }
    this.sql.exec('CREATE TABLE IF NOT EXISTS covers (id TEXT PRIMARY KEY, data BLOB)');
    try { this.sql.exec('ALTER TABLE covers ADD COLUMN h TEXT'); } catch (e) { /* already there */ }
    this.nowMem = undefined; // the 'now playing' report lives in memory: writing it every few seconds would use up the free daily write allowance
    this.sel = 'SELECT t.*, c.id AS has_cover FROM tracks t LEFT JOIN covers c ON c.id = t.cover_id';
  }

  // balances (identical to the Spotify edition)
  async balance(device) { return (await this.ctx.storage.get('bal:' + device)) || 0; }
  async debit(device) {
    const b = await this.balance(device);
    if (b < 1) return { ok: false, left: b };
    await this.ctx.storage.put('bal:' + device, b - 1);
    return { ok: true, left: b - 1 };
  }
  async refund(device) { const b = await this.balance(device); await this.ctx.storage.put('bal:' + device, b + 1); return b + 1; }
  async creditSession(sessionId, device, plays, amountPence) {
    if (await this.ctx.storage.get('sess:' + sessionId)) return { credited: false };
    await this.ctx.storage.put('sess:' + sessionId, Date.now());
    const b = await this.balance(device);
    await this.ctx.storage.put('bal:' + device, b + plays);
    const sales = (await this.ctx.storage.get('sales')) || [];
    sales.unshift({ at: Date.now(), code: codeFor(device), plays, amountPence });
    await this.ctx.storage.put('sales', sales.slice(0, 100));
    return { credited: true, plays: b + plays };
  }
  async grant(device, plays) { const b = await this.balance(device); await this.ctx.storage.put('bal:' + device, b + plays); return b + plays; }
  async registerCode(device) { const code = codeFor(device); await this.ctx.storage.put('code:' + code, device); return code; }
  async deviceForCode(code) { return (await this.ctx.storage.get('code:' + String(code).toUpperCase())) || null; }
  async bumpTrack(t) {
    const top = (await this.ctx.storage.get('top')) || {};
    const e = top[t.uri] || { name: t.name, artist: t.artist, count: 0 };
    e.count += 1; top[t.uri] = e;
    const keep = Object.entries(top).sort((a, b) => b[1].count - a[1].count).slice(0, 300);
    await this.ctx.storage.put('top', Object.fromEntries(keep));
  }
  async bumpArtists(list) {
    const m = (await this.ctx.storage.get('artistsPlayed')) || {};
    for (const a of list || []) {
      if (!a.id) continue;
      const e = m[a.id] || { name: a.name, count: 0 };
      e.count += 1; e.name = a.name; m[a.id] = e;
    }
    const keep = Object.entries(m).sort((x, y) => y[1].count - x[1].count).slice(0, 600);
    await this.ctx.storage.put('artistsPlayed', Object.fromEntries(keep));
  }
  async artistsPlayed(n = 50) {
    const m = (await this.ctx.storage.get('artistsPlayed')) || {};
    return Object.entries(m).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count).slice(0, n);
  }
  async top(n = 10) {
    const top = (await this.ctx.storage.get('top')) || {};
    return Object.values(top).sort((a, b) => b.count - a.count).slice(0, n);
  }
  async sales() { return (await this.ctx.storage.get('sales')) || []; }

  // catalogue
  async catPrune(keep) { // remove tracks that are no longer in the catalogue
    const want = new Set(keep); let gone = 0;
    for (const r of this.sql.exec('SELECT id FROM tracks').toArray()) if (!want.has(r.id)) { this.sql.exec('DELETE FROM tracks WHERE id=?', r.id); gone++; }
    return gone;
  }
  async coversPrune(keep) {
    const want = new Set(keep); let gone = 0;
    for (const r of this.sql.exec('SELECT id FROM covers').toArray()) if (!want.has(r.id)) { this.sql.exec('DELETE FROM covers WHERE id=?', r.id); gone++; }
    return gone;
  }
  async catAdd(rows) {
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        const old = this.sql.exec('SELECT path, artist, artist_id, title, album, seconds, cover_id FROM tracks WHERE id=?', r.id).toArray()[0];
        if (old && old.path === r.path && old.artist === r.artist && old.artist_id === r.artistId && old.title === r.title && old.album === (r.album || '')
            && old.seconds === Math.max(0, Math.round(r.seconds || 0)) && (old.cover_id || null) === (r.coverId || null)) continue; // unchanged: no write
        this.sql.exec('INSERT OR REPLACE INTO tracks (id, path, artist, artist_id, artist_key, title, title_key, all_key, album, seconds, cover_id, album_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          r.id, r.path, r.artist, r.artistId, artistKey(r.artist), r.title, norm(r.title),
          norm(r.artist + ' ' + r.title), r.album || '', Math.max(0, Math.round(r.seconds || 0)), r.coverId || null, artistKey(r.album || ''));
      }
    });
    return this.catCount();
  }
  async catCount() { return this.sql.exec('SELECT COUNT(*) n FROM tracks').one().n; }
  async trackById(id) { return this.sql.exec(this.sel + ' WHERE t.id=?', id).toArray()[0] || null; }
  async addCovers(items) {
    let wrote = 0;
    this.ctx.storage.transactionSync(() => {
      for (const c of items) {
        const old = this.sql.exec('SELECT h FROM covers WHERE id=?', c.id).toArray()[0];
        if (old && old.h && old.h === c.h) continue; // same picture already stored: no write
        this.sql.exec('INSERT OR REPLACE INTO covers (id, data, h) VALUES (?, ?, ?)', c.id, c.bytes, c.h || null); wrote++;
      }
    });
    return this.sql.exec('SELECT COUNT(*) n FROM covers').one().n;
  }
  async cover(id) { const r = this.sql.exec('SELECT data FROM covers WHERE id=?', id).toArray()[0]; return r ? r.data : null; }
  async searchArtists(q) {
    const t = tokens(q).map(x => x.replace(/^the$/, ''));
    const toks = t.filter(Boolean);
    if (!toks.length) return [];
    const where = toks.map(() => 'artist_key LIKE ?').join(' AND ');
    const binds = toks.map(x => '%' + x + '%');
    const first = toks[0] + '%';
    return this.sql.exec(
      `SELECT artist_id id, artist name, COUNT(*) c FROM tracks WHERE ${where}
       GROUP BY artist_id ORDER BY (artist_key LIKE ?) DESC, c DESC LIMIT 8`, ...binds, first).toArray()
      .map(r => ({ id: r.id, name: r.name, image: '' }));
  }
  // Browse: which first letters have anything, then the cards for one letter (albums or artists)
  async letters(kind) {
    const rows = kind === 'artists'
      ? this.sql.exec("SELECT UPPER(substr(artist_key,1,1)) l, COUNT(DISTINCT artist_id) n FROM tracks GROUP BY l").toArray()
      : this.sql.exec("SELECT UPPER(substr(album_key,1,1)) l, COUNT(DISTINCT cover_id) n FROM tracks WHERE cover_id IS NOT NULL AND album_key != '' GROUP BY l").toArray();
    const out = {};
    for (const r of rows) { const k = /^[A-Z]$/.test(r.l) ? r.l : '#'; out[k] = (out[k] || 0) + r.n; }
    return out;
  }
  async browseAlbums({ letter, artistId }) {
    const cond = artistId ? 't.artist_id = ?' : (letter === '#' ? "t.album_key NOT GLOB '[a-z]*'" : "t.album_key GLOB ?");
    const bind = artistId ? [artistId] : (letter === '#' ? [] : [letter.toLowerCase() + '*']);
    return this.sql.exec(
      `SELECT t.cover_id id, MIN(t.album) album, MIN(t.artist) artist, t.artist_id artistId, COUNT(*) n, MAX(c.id) cover
       FROM tracks t LEFT JOIN covers c ON c.id = t.cover_id
       WHERE t.cover_id IS NOT NULL AND t.album_key != '' AND ${cond}
       GROUP BY t.cover_id ORDER BY MIN(t.album_key) LIMIT 300`, ...bind).toArray()
      .map(r => ({ id: r.id, name: r.album, artist: r.artist, artistId: r.artistId, n: r.n, image: r.cover ? '/cover/' + r.cover : '' }));
  }
  async browseArtists({ letter }) {
    const cond = letter === '#' ? "t.artist_key NOT GLOB '[a-z]*'" : 't.artist_key GLOB ?';
    const bind = letter === '#' ? [] : [letter.toLowerCase() + '*'];
    return this.sql.exec(
      `SELECT t.artist_id id, MIN(t.artist) name, COUNT(*) n, MAX(CASE WHEN c.id IS NOT NULL THEN t.cover_id END) cover
       FROM tracks t LEFT JOIN covers c ON c.id = t.cover_id
       WHERE ${cond} GROUP BY t.artist_id ORDER BY MIN(t.artist_key) LIMIT 400`, ...bind).toArray()
      .map(r => ({ id: r.id, name: r.name, n: r.n, image: r.cover ? '/cover/' + r.cover : '' }));
  }
  async albumTracks(coverId) {
    return this.sql.exec(`${this.sel} WHERE t.cover_id = ? ORDER BY t.path LIMIT 80`, coverId).toArray().map(shape);
  }
  async searchTracks({ q, artistId }) {
    const toks = tokens(q);
    if (artistId) {
      const where = ['t.artist_id=?'].concat(toks.map(() => 't.title_key LIKE ?')).join(' AND ');
      const rows = this.sql.exec(`${this.sel} WHERE ${where} LIMIT 300`, artistId, ...toks.map(x => '%' + x + '%')).toArray();
      const top = (await this.ctx.storage.get('top')) || {};
      rows.sort((a, b) => ((top['local:' + b.id]?.count || 0) - (top['local:' + a.id]?.count || 0)) || a.title.localeCompare(b.title));
      return rows.slice(0, toks.length ? 24 : 40).map(shape);
    }
    if (!toks.length) return [];
    const where = toks.map(() => 't.all_key LIKE ?').join(' AND ');
    const rows = this.sql.exec(`${this.sel} WHERE ${where} ORDER BY (t.title_key LIKE ?) DESC, t.title LIMIT 24`,
      ...toks.map(x => '%' + x + '%'), toks.join(' ') + '%').toArray();
    return rows.map(shape);
  }

  // queue + player
  async getPending() { return (await this.ctx.storage.get('pending')) || []; }
  async setPending(list) { await this.ctx.storage.put('pending', list); }
  async getNow() { if (this.nowMem === undefined) this.nowMem = (await this.ctx.storage.get('now')) || null; return this.nowMem; }
  async setNow(n) {
    const prev = this.nowMem === undefined ? (await this.ctx.storage.get('now')) : this.nowMem;
    this.nowMem = n;
    // only touch storage when the song changes (once per song), not on every progress report
    if (!prev || !prev.track || !n.track || prev.track.id !== n.track.id) await this.ctx.storage.put('now', n);
  }
  async getTheme() { if (this.themeMem === undefined) this.themeMem = (await this.ctx.storage.get('theme')) || 'classic'; return this.themeMem; }
  async setTheme(t) { this.themeMem = t; await this.ctx.storage.put('theme', t); }
  async pushCmd(c) { const l = (await this.ctx.storage.get('cmds')) || []; l.push(c); await this.ctx.storage.put('cmds', l.slice(-10)); }
  async takeCmds() { const l = (await this.ctx.storage.get('cmds')) || []; if (l.length) await this.ctx.storage.put('cmds', []); return l; }
  // Player asks for the next paid track. Returns it (with its file path) and removes it from the queue.
  async nextRequest() {
    const p = await this.getPending();
    if (!p.length) return null;
    const first = p.shift();
    await this.setPending(p);
    const row = await this.trackById(first.id);
    if (!row) return this.nextRequest(); // vanished from the catalogue: skip it
    return { ...shape(row), path: row.path };
  }
}

function codeFor(device) {
  let h = 0;
  for (const ch of String(device)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36).toUpperCase().padStart(5, '0').slice(-5);
}

// ── HELPERS ──────────────────────────────────────────────────
const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function makeToken(env, w) { return w + '.' + (await hmacHex(env.SESSION_SECRET, 'session:' + w)).slice(0, 32); }
async function tokenValid(env, token) {
  if (!token) return false;
  const now = Math.floor(Date.now() / SESSION_WINDOW_MS);
  for (const w of [now, now - 1]) if (safeEqual(token, await makeToken(env, w))) return true;
  return false;
}

async function readState(ledger) {
  const [now, pending, theme] = await Promise.all([ledger.getNow(), ledger.getPending(), ledger.getTheme()]);
  const online = !!now && (Date.now() - now.reportedAt) < PLAYER_STALE_MS;
  const playing = online && !!now.playing && !!now.track;
  let track = null;
  if (now && now.track && online) {
    const elapsed = playing ? Date.now() - now.reportedAt : 0;
    track = { ...now.track, progress: Math.min(now.track.duration, (now.progress || 0) + elapsed) };
  }
  return {
    ts: Date.now(), playing, offline: !online, canRemove: true, track, theme,
    queue: pending.map(p => ({ uri: p.uri, id: p.id, name: p.name, artist: p.artist, image: p.image || '', duration: p.duration })),
  };
}
async function cachedState(ctx, ledger) {
  const cache = caches.default;
  const key = new Request('https://state.internal/' + VENUE);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const state = await readState(ledger);
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(state), { headers: { 'Cache-Control': 'max-age=3' } })));
  return state;
}
async function bustState() { await caches.default.delete(new Request('https://state.internal/' + VENUE)); }

async function stripe(env, path, params) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: params ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
  });
  return res.json();
}
async function verifyStripeSignature(env, body, header) {
  if (!header || !env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  return safeEqual(await hmacHex(env.STRIPE_WEBHOOK_SECRET, parts.t + '.' + body), parts.v1);
}

// Add a catalogue track to the paid queue (shared by guests and staff).
async function enqueue(ledger, uri, device) {
  if (!TRACK_URI.test(uri || '')) return { error: 'Bad request', status: 400 };
  const id = uri.slice(6);
  const [row, pending, now] = await Promise.all([ledger.trackById(id), ledger.getPending(), ledger.getNow()]);
  if (!row) return { error: 'Track not found', status: 404 };
  if (pending.some(p => p.id === id) || (now && now.track && now.track.id === id && (Date.now() - now.reportedAt) < PLAYER_STALE_MS))
    return { error: 'That track is already in the queue', status: 409 };
  const track = shape(row);
  return { track, commit: async () => { await ledger.setPending([...pending, { ...track, addedAt: Date.now(), by: device || '' }]); await ledger.bumpTrack(track); await ledger.bumpArtists(track.artists); await bustState(); } };
}

// ── WORKER ───────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const origin = env.SITE_URL || '*';
    const CORS = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session, X-Display-Key, X-Staff-Pin',
      Vary: 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(VENUE));
    const needSession = async () => tokenValid(env, request.headers.get('X-Session'));
    const isStaff = () => env.STAFF_PIN && safeEqual(request.headers.get('X-Staff-Pin') || '', env.STAFF_PIN);
    const isDisplay = () => env.DISPLAY_KEY && safeEqual(request.headers.get('X-Display-Key') || '', env.DISPLAY_KEY);
    const isPlayer = () => env.PLAYER_KEY && safeEqual(request.headers.get('X-Player-Key') || '', env.PLAYER_KEY);
    const NOSESSION = { error: 'Scan the QR code on the screen to start' };

    try {
      if (path === '/ping') return json({ ok: true, venue: VENUE, edition: 'home' });

      if (path === '/stripe-webhook' && request.method === 'POST') {
        const body = await request.text();
        if (!(await verifyStripeSignature(env, body, request.headers.get('Stripe-Signature')))) return new Response('bad signature', { status: 400 });
        const event = JSON.parse(body);
        if (event.type === 'checkout.session.completed') {
          const s = event.data.object, tier = TIERS[s.metadata?.tier];
          if (s.metadata?.venue === VENUE && s.payment_status === 'paid' && tier && s.metadata.device_id)
            await ledger.creditSession(s.id, s.metadata.device_id, tier.plays, tier.amountPence);
        }
        return new Response('ok');
      }

      if (path === '/session-token') {
        if (!isDisplay()) return json({ error: 'Not allowed' }, 403);
        const w = Math.floor(Date.now() / SESSION_WINDOW_MS);
        return json({ token: await makeToken(env, w), expiresAt: (w + 1) * SESSION_WINDOW_MS });
      }
      if (path === '/check-session') return json({ ok: await tokenValid(env, url.searchParams.get('s')) });
      if (path === '/state') return json(await cachedState(ctx, ledger));
      if (path === '/top10') return json({ top: await ledger.top(10) });
      if (path === '/fact') {
        const name = (url.searchParams.get('name') || '').slice(0, 100);
        const artist = (url.searchParams.get('artist') || '').slice(0, 100);
        if (!name || !env.ANTHROPIC_API_KEY) return json({ fact: null });
        const cache = caches.default;
        const key = new Request('https://fact.internal/' + encodeURIComponent(name + '|' + artist));
        const hit = await cache.match(key);
        if (hit) return json(await hit.json());
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 120, messages: [{ role: 'user', content:
            `Write ONE short, true, fun fact (max 25 words) about the song "${name}" by ${artist}, for a rock and metal pub screen. ` +
            `Only state something you are certain is accurate. If you are not certain, reply with exactly NONE. No preamble, no quotes.` }] }),
        });
        const data = await res.json();
        let fact = (data.content?.[0]?.text || '').trim();
        if (!fact || /^none\b/i.test(fact)) fact = null;
        const out = { fact };
        ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=86400' } })));
        return json(out);
      }

      // Album art thumbnails (public; they are not sensitive and are cached hard)
      if (path.startsWith('/cover/')) {
        const id = path.slice(7);
        if (!/^[0-9a-f]{10}$/.test(id)) return new Response('not found', { status: 404 });
        const bytes = await ledger.cover(id);
        if (!bytes) return new Response('not found', { status: 404 });
        return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
      }

      // ── Player program (on the jukebox PC) ──
      if (path.startsWith('/player/')) {
        if (!isPlayer()) return json({ error: 'Not allowed' }, 403);
        if (path === '/player/ping') return json({ ok: true, tracks: await ledger.catCount() });
        if (path === '/player/catalogue' && request.method === 'POST') {
          const { rows, prune } = await request.json();
          if (Array.isArray(prune)) return json({ ok: true, removed: await ledger.catPrune(prune.filter(x => /^[0-9a-f]{10}$/.test(x))), total: await ledger.catCount() });
          const good = (rows || []).filter(r => r && /^[0-9a-f]{10}$/.test(r.id) && r.path && r.artist && r.title && r.artistId).slice(0, 600)
            .map(r => ({ id: r.id, path: String(r.path).slice(0, 400), artist: String(r.artist).slice(0, 120), artistId: String(r.artistId).slice(0, 16),
              title: String(r.title).slice(0, 160), album: String(r.album || '').slice(0, 160), seconds: r.seconds,
              coverId: /^[0-9a-f]{10}$/.test(r.coverId || '') ? r.coverId : null }));
          return json({ ok: true, added: good.length, total: await ledger.catAdd(good) });
        }
        if (path === '/player/covers' && request.method === 'POST') {
          const { items, prune } = await request.json();
          if (Array.isArray(prune)) return json({ ok: true, removed: await ledger.coversPrune(prune.filter(x => /^[0-9a-f]{10}$/.test(x))) });
          const good = (items || []).slice(0, 60).filter(c => c && /^[0-9a-f]{10}$/.test(c.id) && typeof c.data === 'string' && c.data.length < 300000)
            .map(c => ({ id: c.id, h: String(c.h || '').slice(0, 40), bytes: Uint8Array.from(atob(c.data), ch => ch.charCodeAt(0)) }));
          return json({ ok: true, added: good.length, total: await ledger.addCovers(good) });
        }
        if (path === '/player/next' && request.method === 'POST') {
          const t = await ledger.nextRequest();
          if (t) await ledger.setNow({ track: { uri: t.uri, id: t.id, name: t.name, artist: t.artist, artists: t.artists, image: t.image || '', duration: t.duration, explicit: false }, progress: 0, playing: true, reportedAt: Date.now(), kind: 'request' });
          await bustState();
          return json({ track: t });
        }
        if (path === '/player/report' && request.method === 'POST') {
          const { id, progress, playing, kind } = await request.json();
          let track = null;
          if (id) { const row = await ledger.trackById(String(id)); if (row) track = shape(row); }
          await ledger.setNow({ track, progress: Math.max(0, Number(progress) || 0), playing: !!playing, reportedAt: Date.now(), kind: kind === 'request' ? 'request' : 'house' });
          return json({ ok: true, cmds: await ledger.takeCmds() });
        }
      }

      // ── Guest endpoints ──
      if (path.startsWith('/control/') && request.method === 'POST') { // home only: any phone can pause / resume / skip
        if (!(await needSession())) return json(NOSESSION, 401);
        const cmd = path.slice(9);
        if (!['pause', 'play', 'skip'].includes(cmd)) return json({ error: 'Unknown control' }, 400);
        await ledger.pushCmd(cmd); await bustState(); return json({ ok: true });
      }
      if (path === '/search-artists') {
        if (!(await needSession())) return json(NOSESSION, 401);
        return json({ items: await ledger.searchArtists(url.searchParams.get('q')) });
      }
      if (path.startsWith('/browse/')) {
        if (!(await needSession())) return json(NOSESSION, 401);
        const letter = (url.searchParams.get('letter') || '').toUpperCase();
        const okLetter = /^[A-Z#]$/.test(letter);
        if (path === '/browse/letters') return json({ letters: await ledger.letters(url.searchParams.get('kind') === 'artists' ? 'artists' : 'albums') });
        if (path === '/browse/albums') {
          const artistId = (url.searchParams.get('artist_id') || '').slice(0, 16);
          if (!artistId && !okLetter) return json({ items: [] });
          return json({ items: await ledger.browseAlbums({ letter, artistId }) });
        }
        if (path === '/browse/artists') return json({ items: okLetter ? await ledger.browseArtists({ letter }) : [] });
      }
      if (path === '/search') {
        if (!(await needSession())) return json(NOSESSION, 401);
        const albumId = url.searchParams.get('album_id') || '';
        if (/^[0-9a-f]{10}$/.test(albumId)) return json({ items: await ledger.albumTracks(albumId) });
        return json({ items: await ledger.searchTracks({ q: url.searchParams.get('q') || '', artistId: (url.searchParams.get('artist_id') || '').slice(0, 16) }) });
      }
      if (path === '/balance') {
        if (!(await needSession())) return json(NOSESSION, 401);
        const device = url.searchParams.get('device_id') || '';
        if (!device) return json({ error: 'No device' }, 400);
        return json({ free: true, max: MAX_QUEUED, waiting: (await ledger.getPending()).filter(p => p.by === device).length });
      }
      if (path === '/request' && request.method === 'POST') {
        if (!(await needSession())) return json(NOSESSION, 401);
        const { device_id, uri } = await request.json();
        if (!device_id) return json({ error: 'Bad request' }, 400);
        const mineWaiting = (await ledger.getPending()).filter(p => p.by === device_id).length;
        if (mineWaiting >= MAX_QUEUED) return json({ error: `You already have ${MAX_QUEUED} songs waiting. Let some play first.` }, 429);
        const e = await enqueue(ledger, uri, device_id);
        if (e.error) return json({ error: e.error }, e.status);
        await e.commit();
        return json({ ok: true, track: e.track });
      }
      if (path === '/create-checkout' && request.method === 'POST') {
        if (!(await needSession())) return json(NOSESSION, 401);
        return json({ error: 'This jukebox is free.' }, 404);
        const { device_id, tier } = await request.json();
        const t = TIERS[tier];
        if (!device_id || !t) return json({ error: 'Bad request' }, 400);
        const s = await stripe(env, '/checkout/sessions', {
          mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'gbp',
          'line_items[0][price_data][unit_amount]': String(t.amountPence),
          'line_items[0][price_data][product_data][name]': `Banshee Jukebox: ${t.plays} plays`,
          'metadata[venue]': VENUE, 'metadata[device_id]': device_id, 'metadata[tier]': tier,
          success_url: `${env.SITE_URL}/?paid=1`, cancel_url: `${env.SITE_URL}/`,
        });
        if (!s.url) return json({ error: 'Could not start checkout' }, 502);
        return json({ url: s.url });
      }

      // ── Staff endpoints ──
      if (path.startsWith('/staff/')) {
        if (!isStaff()) return json({ error: 'Wrong PIN' }, 403);
        if (path === '/staff/check') return json({ ok: true });
        if (path === '/staff/overview') return json({ state: await readState(ledger), sales: await ledger.sales() });
        for (const [p, cmd] of [['skip', 'skip'], ['pause', 'pause'], ['play', 'play']])
          if (path === '/staff/' + p && request.method === 'POST') { await ledger.pushCmd(cmd); await bustState(); return json({ ok: true }); }
        if (path === '/staff/theme' && request.method === 'POST') {
          const { theme } = await request.json();
          if (!['classic', 'gothic'].includes(theme)) return json({ error: 'Unknown look' }, 400);
          await ledger.setTheme(theme); await bustState(); return json({ ok: true, theme });
        }
        if (path === '/staff/grant' && request.method === 'POST') {
          const { code, plays } = await request.json();
          const device = await ledger.deviceForCode(code || '');
          const n = Math.max(1, Math.min(20, parseInt(plays, 10) || 0));
          if (!device) return json({ error: 'No guest with that code' }, 404);
          return json({ ok: true, plays: await ledger.grant(device, n) });
        }
        if (path === '/staff/queue' && request.method === 'POST') {
          const { uri } = await request.json();
          const e = await enqueue(ledger, uri);
          if (e.error) return json({ error: e.error }, e.status);
          await e.commit();
          return json({ ok: true, track: e.track });
        }
        if (path === '/staff/remove' && request.method === 'POST') {
          const { uri } = await request.json();
          const pending = await ledger.getPending();
          const left = pending.filter(p => p.uri !== uri);
          if (left.length === pending.length) return json({ error: 'Not in the queue' }, 404);
          await ledger.setPending(left); await bustState();
          return json({ ok: true });
        }
        if (path === '/staff/artists') return json({ artists: await ledger.artistsPlayed(60) });
        if (path === '/staff/search-artists') return json({ items: await ledger.searchArtists(url.searchParams.get('q')) });
        if (path === '/staff/search') return json({ items: await ledger.searchTracks({ q: url.searchParams.get('q') || '', artistId: (url.searchParams.get('artist_id') || '').slice(0, 16) }) });
      }

      return json({ error: 'Unknown endpoint' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
