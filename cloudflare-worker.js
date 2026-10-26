// ============================================================
//  BANSHEE JUKEBOX — Cloudflare Worker
//  Spotify queueing, Stripe payments, play credits, AI facts.
//  Separate from the Black Rose worker: own secrets, own ledger.
// ============================================================
import { DurableObject } from 'cloudflare:workers';

// Server-side price list. The phone only ever sends a tier id.
const TIERS = {
  tier1: { amountPence: 100, plays: 2, label: '£1' },
  tier2: { amountPence: 200, plays: 5, label: '£2' },
};
const VENUE = 'banshee';
const SESSION_WINDOW_MS = 2 * 60 * 60 * 1000; // screen QR token lasts 2-4 hours
const TABLE_PASS_MS = 60 * 60 * 1000; // a scan of the table QR gives that phone one hour
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;
const MAX_TRACK_MS = 7 * 60 * 1000; // guests can't pick anything longer than 7 minutes
const playable = t => !!t && (t.type === undefined || t.type === 'track') && !t.is_local && (t.duration_ms || 0) > 0 && t.duration_ms <= MAX_TRACK_MS;

// ── LEDGER (Durable Object) ──────────────────────────────────
// One instance holds every balance and the pending queue, so two
// requests can never spend the same play twice.
export class Ledger extends DurableObject {
  async balance(device) {
    return (await this.ctx.storage.get('bal:' + device)) || 0;
  }
  async debit(device) {
    const b = await this.balance(device);
    if (b < 1) return { ok: false, left: b };
    await this.ctx.storage.put('bal:' + device, b - 1);
    return { ok: true, left: b - 1 };
  }
  async refund(device) {
    const b = await this.balance(device);
    await this.ctx.storage.put('bal:' + device, b + 1);
    return b + 1;
  }
  // Idempotent: the same Stripe session can only ever credit once.
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
  async grant(device, plays) {
    const b = await this.balance(device);
    await this.ctx.storage.put('bal:' + device, b + plays);
    return b + plays;
  }
  async registerCode(device) {
    const code = codeFor(device);
    await this.ctx.storage.put('code:' + code, device);
    return code;
  }
  async deviceForCode(code) {
    return (await this.ctx.storage.get('code:' + String(code).toUpperCase())) || null;
  }
  async getPending() { return (await this.ctx.storage.get('pending')) || []; }
  async setPending(list) { await this.ctx.storage.put('pending', list); }
  async bumpTrack(t) {
    const top = (await this.ctx.storage.get('top')) || {};
    const e = top[t.uri] || { name: t.name, artist: t.artist, count: 0 };
    e.count += 1;
    top[t.uri] = e;
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
  async getBlocked() { return (await this.ctx.storage.get('blocked')) || []; }
  async block(a) {
    const list = await this.getBlocked();
    if (!list.some(x => x.id === a.id)) { list.push({ id: a.id, name: a.name }); await this.ctx.storage.put('blocked', list); }
    return list;
  }
  async blockMany(artists) {
    const list = await this.getBlocked();
    for (const a of artists) if (!list.some(x => x.id === a.id)) list.push({ id: a.id, name: a.name });
    await this.ctx.storage.put('blocked', list);
    return list;
  }
  async unblock(id) {
    const list = (await this.getBlocked()).filter(x => x.id !== id);
    await this.ctx.storage.put('blocked', list);
    return list;
  }
  async blockLists() { return { artists: await this.getBlocked(), tracks: (await this.ctx.storage.get('blockedTracks')) || [] }; }
  async blockTracks(entries) {
    const list = (await this.ctx.storage.get('blockedTracks')) || [];
    for (const e of entries) if (!list.some(x => x.uri === e.uri)) list.push(e);
    await this.ctx.storage.put('blockedTracks', list);
    return list;
  }
  async unblockTrack(uri) {
    const list = ((await this.ctx.storage.get('blockedTracks')) || []).filter(x => x.uri !== uri);
    await this.ctx.storage.put('blockedTracks', list);
    return list;
  }
  async tableEpoch() { return (await this.ctx.storage.get('tableEpoch')) || 0; }
  async rotateTable() { const e = (await this.tableEpoch()) + 1; await this.ctx.storage.put('tableEpoch', e); return e; }
  async getBrowse() { return (await this.ctx.storage.get('browseArtists')) || []; }
  async browseAdd(entries) {
    const list = await this.getBrowse();
    for (const e of entries) if (!list.some(x => x.id === e.id)) list.push(e);
    await this.ctx.storage.put('browseArtists', list);
    return list;
  }
  async browseRemove(id) {
    const list = (await this.getBrowse()).filter(x => x.id !== id);
    await this.ctx.storage.put('browseArtists', list);
    return list;
  }
  async top(n = 10) {
    const top = (await this.ctx.storage.get('top')) || {};
    return Object.values(top).sort((a, b) => b.count - a.count).slice(0, n);
  }
  async sales() { return (await this.ctx.storage.get('sales')) || []; }
}

function codeFor(device) {
  // Short code shown on the guest's phone so staff can find them.
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
async function makeToken(env, windowIndex) {
  return windowIndex + '.' + (await hmacHex(env.SESSION_SECRET, 'session:' + windowIndex)).slice(0, 32);
}
async function makeTableToken(env, epoch) {
  const exp = Date.now() + TABLE_PASS_MS;
  return { token: `t.${exp}.${epoch}.` + (await hmacHex(env.SESSION_SECRET, `table:${exp}:${epoch}`)).slice(0, 32), expiresAt: exp };
}
const tableKey = async (env, epoch) => (await hmacHex(env.SESSION_SECRET, 'tablekey:' + epoch)).slice(0, 20);
async function tableTokenValid(env, token, epoch) {
  const p = String(token || '').split('.');
  if (p.length !== 4 || p[0] !== 't' || !(Number(p[1]) > Date.now()) || p[2] !== String(epoch)) return false;
  return safeEqual(p[3], (await hmacHex(env.SESSION_SECRET, `table:${p[1]}:${p[2]}`)).slice(0, 32));
}
async function tokenValid(env, token) {
  if (!token) return false;
  const now = Math.floor(Date.now() / SESSION_WINDOW_MS);
  for (const w of [now, now - 1]) {
    if (safeEqual(token, await makeToken(env, w))) return true;
  }
  return false;
}

let spotifyToken = { value: null, exp: 0 };
async function getAccessToken(env) {
  if (spotifyToken.value && Date.now() < spotifyToken.exp) return spotifyToken.value;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Spotify token refresh failed');
  spotifyToken = { value: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}
async function spotify(env, path, init = {}) {
  const token = await getAccessToken(env);
  return fetch('https://api.spotify.com/v1' + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) },
  });
}
function cleanName(n) {
  return String(n || '').replace(/\s*(?:-|\u2013|\(|\[)\s*(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*[)\]]?\s*$/i, '').trim();
}
const sameTrack = (a, b) =>
  !!a && !!b && (a.id === b.id || a.uri === b.uri ||
    (cleanName(a.name).toLowerCase() === cleanName(b.name).toLowerCase() &&
     String(a.artist || a.artists?.[0]?.name || '').toLowerCase() === String(b.artist || b.artists?.[0]?.name || '').toLowerCase()));
function trackShape(t) {
  return {
    uri: t.uri,
    id: t.id,
    name: cleanName(t.name),
    artist: (t.artists || []).map(a => a.name).join(', '),
    artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })),
    image: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '',
    imageLarge: t.album?.images?.[0]?.url || '',
    duration: t.duration_ms,
    explicit: !!t.explicit,
  };
}

// ── STATE: now playing + our paid queue ──────────────────────
async function readState(env, ledger) {
  const [cur, q] = await Promise.all([
    spotify(env, '/me/player/currently-playing'),
    spotify(env, '/me/player/queue'),
  ]);
  const curData = cur.status === 200 ? await cur.json() : null;
  const qData = q.status === 200 ? await q.json() : { queue: [] };
  const item = curData?.item || null;
  const playing = !!(curData && curData.is_playing && item);

  // Our own list is the source of truth for what was paid for. Spotify's queue
  // is only used to tidy it up, because it can lag a few seconds behind and
  // sometimes reports a different ID for the same song.
  let pending = await ledger.getPending();
  const spotifyQueue = qData.queue || [];
  const now = Date.now();
  if (item) {
    const k = pending.findIndex(p => sameTrack(p, trackShape(item)));
    if (k >= 0) pending = pending.slice(k + 1); // it has started playing
  }
  // Drop anything Spotify no longer has, but not within 45s of being added.
  pending = pending.filter(p => (now - (p.addedAt || 0)) < 45000 || spotifyQueue.some(x => sameTrack(p, trackShape(x))));
  await ledger.setPending(pending);
  const up = pending.map(p => ({ uri: p.uri, id: p.id, name: p.name, artist: p.artist, image: p.image || '', duration: p.duration }));

  return {
    ts: Date.now(),
    playing,
    track: item ? { ...trackShape(item), progress: curData.progress_ms || 0 } : null,
    queue: up,
  };
}
async function cachedState(env, ctx, ledger) {
  const cache = caches.default;
  const key = new Request('https://state.internal/' + VENUE);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const state = await readState(env, ledger);
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(state), { headers: { 'Cache-Control': 'max-age=4' } })));
  return state;
}
async function bustState() {
  await caches.default.delete(new Request('https://state.internal/' + VENUE));
}

// ── STRIPE ───────────────────────────────────────────────────
async function stripe(env, path, params) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: params ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
  });
  return res.json();
}
async function verifyStripeSignature(env, body, header) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, parts.t + '.' + body);
  return safeEqual(expected, parts.v1);
}

// ── SEARCH (shared by guests and staff) ─────────────────────
async function artistSearch(env, qRaw) {
  const q = (qRaw || '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const data = await (await spotify(env, `/search?q=${encodeURIComponent(q)}&type=artist&limit=8`)).json();
  return (data.artists?.items || []).map(a => ({ id: a.id, name: a.name, image: a.images?.[2]?.url || a.images?.[0]?.url || '' }));
}
// Artists the staff have blocked: guests can't find them or request them. Staff can still add them.
const isBlocked = (artists, blocked) => !!blocked.length && (artists || []).some(a => blocked.some(b => b.id === a.id));
// Picks the artist whose name matches exactly (ignoring case, accents and punctuation); the most popular if several share the name.
const normName = n => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function pickArtist(items, name) {
  const want = normName(name);
  const same = (items || []).filter(a => normName(a.name) === want);
  return same.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0] || null;
}
// Blocked songs match by exact track, or by the same title from the same artist (so remasters and reissues are caught too).
const normTitle = n => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s[-–—]\s.*$/, '').replace(/[\(\[].*?[\)\]]/g, '').replace(/[^a-z0-9]/g, '');
const isBlockedSong = (t, tracks) => !!tracks.length && tracks.some(b => b.uri === t.uri || (b.title && normTitle(t.name) === b.title && (t.artists || []).some(a => (b.artistIds || []).includes(a.id))));
const isHidden = (t, lists) => isBlocked(t.artists, lists.artists) || isBlockedSong(t, lists.tracks);
async function trackSearch(env, params, lists = { artists: [], tracks: [] }) {
  const q = (params.get('q') || '').trim().slice(0, 100).replace(/"/g, '');
  const artistId = (params.get('artist_id') || '').slice(0, 40);
  const artist = (params.get('artist') || '').trim().slice(0, 100).replace(/"/g, '');
  const get = async (query, offset) => (await (await spotify(env, `/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=${offset}`)).json()).tracks?.items || [];
  let raw = [];
  if (artistId && artist) {
    // By artist: this artist's tracks, most relevant first. Filtering by artist id drops covers and other bands.
    const query = q.length >= 2 ? `track:"${q}" artist:"${artist}"` : `artist:"${artist}"`;
    const pages = await Promise.all((q.length >= 2 ? [0, 10] : [0, 10, 20]).map(o => get(query, o)));
    raw = pages.flat().filter(t => (t.artists || []).some(a => a.id === artistId));
  } else {
    if (q.length < 2) return [];
    raw = await get(q, 0);
  }
  const seen = new Set(), items = [];
  for (const t of raw) {
    if (!playable(t)) continue; // no tracks over 7 minutes, no local files
    if (isHidden(t, lists)) continue;
    const sh = trackShape(t);
    const key = sh.name.toLowerCase() + '|' + sh.artist.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); items.push(sh);
  }
  return items.slice(0, 24);
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
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(VENUE));
    const sessionOk = async tok => (await tokenValid(env, tok)) || (String(tok || '').startsWith('t.') && tableTokenValid(env, tok, await ledger.tableEpoch()));
    const needSession = async () => sessionOk(request.headers.get('X-Session'));
    const isStaff = () => env.STAFF_PIN && safeEqual(request.headers.get('X-Staff-Pin') || '', env.STAFF_PIN);
    const isDisplay = () => env.DISPLAY_KEY && safeEqual(request.headers.get('X-Display-Key') || '', env.DISPLAY_KEY);

    try {
      if (path === '/ping') return json({ ok: true, venue: VENUE });

      // Stripe webhook (no CORS/session: verified by signature)
      if (path === '/stripe-webhook' && request.method === 'POST') {
        const body = await request.text();
        if (!(await verifyStripeSignature(env, body, request.headers.get('Stripe-Signature')))) {
          return new Response('bad signature', { status: 400 });
        }
        const event = JSON.parse(body);
        if (event.type === 'checkout.session.completed') {
          const s = event.data.object;
          const tier = TIERS[s.metadata?.tier];
          if (s.metadata?.venue === VENUE && s.payment_status === 'paid' && tier && s.metadata.device_id) {
            await ledger.creditSession(s.id, s.metadata.device_id, tier.plays, tier.amountPence);
          }
        }
        return new Response('ok'); // other venues' events are ignored
      }

      // Display: rotating QR token
      if (path === '/session-token') {
        if (!isDisplay()) return json({ error: 'Not allowed' }, 403);
        const w = Math.floor(Date.now() / SESSION_WINDOW_MS);
        return json({ token: await makeToken(env, w), expiresAt: (w + 1) * SESSION_WINDOW_MS });
      }
      if (path === '/table-pass') {
        const epoch = await ledger.tableEpoch();
        if (!safeEqual(url.searchParams.get('k') || '', await tableKey(env, epoch))) return json({ error: 'This table QR has been retired' }, 403);
        return json(await makeTableToken(env, epoch));
      }
      if (path === '/check-session') {
        return json({ ok: await sessionOk(url.searchParams.get('s')) });
      }

      // Public display data
      if (path === '/state') return json(await cachedState(env, ctx, ledger));
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
          body: JSON.stringify({
            model: env.AI_MODEL || 'claude-haiku-5-5',
            max_tokens: 120,
            messages: [{ role: 'user', content:
              `Write ONE short, true, fun fact (max 25 words) about the song "${name}" by ${artist}, for a rock and metal pub screen. ` +
              `Only state something you are certain is accurate. If you are not certain, reply with exactly NONE. No preamble, no quotes.` }],
          }),
        });
        const data = await res.json();
        let fact = (data.content?.[0]?.text || '').trim();
        if (!fact || /^none\b/i.test(fact)) fact = null;
        const out = { fact };
        ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=86400' } })));
        return json(out);
      }

      // ── Guest endpoints (need the screen-QR session token) ──
      if (path === '/search-artists') {
        if (!(await needSession())) return json({ error: 'Scan the QR code on the screen to start' }, 401);
        const blocked = (await ledger.blockLists()).artists;
        return json({ items: (await artistSearch(env, url.searchParams.get('q'))).filter(a => !blocked.some(b => b.id === a.id)) });
      }
      if (path === '/search') {
        if (!(await needSession())) return json({ error: 'Scan the QR code on the screen to start' }, 401);
        return json({ items: await trackSearch(env, url.searchParams, await ledger.blockLists()) });
      }
      if (path === '/balance') {
        if (!(await needSession())) return json({ error: 'Scan the QR code on the screen to start' }, 401);
        const device = url.searchParams.get('device_id') || '';
        if (!device) return json({ error: 'No device' }, 400);
        return json({ plays: await ledger.balance(device), code: await ledger.registerCode(device) });
      }
      if (path === '/request' && request.method === 'POST') {
        if (!(await needSession())) return json({ error: 'Scan the QR code on the screen to start' }, 401);
        const { device_id, uri } = await request.json();
        if (!device_id || !TRACK_URI.test(uri || '')) return json({ error: 'Bad request' }, 400);
        const pending = await ledger.getPending();
        if (pending.some(p => p.uri === uri)) return json({ error: 'That track is already in the queue' }, 409);
        const spend = await ledger.debit(device_id);
        if (!spend.ok) return json({ error: 'No plays left', needPlays: true }, 402);
        const tRes = await spotify(env, '/tracks/' + uri.split(':')[2]);
        if (!tRes.ok) { await ledger.refund(device_id); return json({ error: 'Track not found' }, 404); }
        const full = await tRes.json();
        if (!playable(full)) { await ledger.refund(device_id); return json({ error: 'Sorry, tracks over 7 minutes can’t be requested. You haven’t been charged a play.' }, 422); }
        if (isHidden(full, await ledger.blockLists())) { await ledger.refund(device_id); return json({ error: 'Sorry, that one isn’t available on this jukebox. You haven’t been charged a play.' }, 422); }
        const track = trackShape(full);
        const qRes = await spotify(env, '/me/player/queue?uri=' + encodeURIComponent(uri), { method: 'POST' });
        if (qRes.status !== 204 && qRes.status !== 200) {
          await ledger.refund(device_id);
          return json({ error: "The jukebox isn't ready. Please tell the bar staff. You haven't been charged a play." }, 503);
        }
        await ledger.setPending([...pending, { ...track, addedAt: Date.now() }]);
        await ledger.bumpTrack(track);
        await ledger.bumpArtists(track.artists);
        await bustState();
        return json({ ok: true, plays: spend.left, track });
      }
      if (path === '/create-checkout' && request.method === 'POST') {
        if (!(await needSession())) return json({ error: 'Scan the QR code on the screen to start' }, 401);
        const { device_id, tier } = await request.json();
        const t = TIERS[tier];
        if (!device_id || !t) return json({ error: 'Bad request' }, 400);
        const site = env.SITE_URL;
        const s = await stripe(env, '/checkout/sessions', {
          mode: 'payment',
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': 'gbp',
          'line_items[0][price_data][unit_amount]': String(t.amountPence),
          'line_items[0][price_data][product_data][name]': `Banshee Jukebox: ${t.plays} plays`,
          'metadata[venue]': VENUE,
          'metadata[device_id]': device_id,
          'metadata[tier]': tier,
          'payment_intent_data[statement_descriptor_suffix]': 'BANSHEE',
          success_url: `${site}/?paid=1`,
          cancel_url: `${site}/`,
        });
        if (!s.url) return json({ error: 'Could not start checkout' }, 502);
        return json({ url: s.url });
      }

      // ── Staff endpoints (PIN checked here, never in the page) ──
      if (path.startsWith('/staff/')) {
        if (!isStaff()) return json({ error: 'Wrong PIN' }, 403);
        if (path === '/staff/check') return json({ ok: true });
        if (path === '/staff/overview') return json({ state: await readState(env, ledger), sales: await ledger.sales() });
        if (path === '/staff/skip' && request.method === 'POST') {
          await spotify(env, '/me/player/next', { method: 'POST' }); await bustState(); return json({ ok: true });
        }
        if (path === '/staff/pause' && request.method === 'POST') {
          await spotify(env, '/me/player/pause', { method: 'PUT' }); await bustState(); return json({ ok: true });
        }
        if (path === '/staff/play' && request.method === 'POST') {
          await spotify(env, '/me/player/play', { method: 'PUT' }); await bustState(); return json({ ok: true });
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
          if (!TRACK_URI.test(uri || '')) return json({ error: 'Bad request' }, 400);
          const tRes = await spotify(env, '/tracks/' + uri.split(':')[2]);
          if (!tRes.ok) return json({ error: 'Track not found' }, 404);
          const track = trackShape(await tRes.json());
          const qRes = await spotify(env, '/me/player/queue?uri=' + encodeURIComponent(uri), { method: 'POST' });
          if (qRes.status !== 204 && qRes.status !== 200) return json({ error: 'Spotify is not ready' }, 503);
          const pending = await ledger.getPending();
          await ledger.setPending([...pending, { ...track, addedAt: Date.now() }]);
          await bustState();
          return json({ ok: true, track });
        }
        if (path === '/staff/browse') return json({ artists: await ledger.getBrowse() });
        if (path === '/staff/browse-add' && request.method === 'POST') {
          const { artists } = await request.json();
          const ok = (Array.isArray(artists) ? artists : []).slice(0, 40).filter(a => /^[A-Za-z0-9]{10,40}$/.test(a.id || '')).map(a => ({ id: a.id, name: String(a.name || '').slice(0, 100), image: String(a.image || '').slice(0, 300), genre: String(a.genre || '').slice(0, 40) }));
          if (!ok.length) return json({ error: 'Nothing to add' }, 400);
          return json({ ok: true, artists: await ledger.browseAdd(ok) });
        }
        if (path === '/staff/browse-remove' && request.method === 'POST') {
          const { id } = await request.json();
          return json({ ok: true, artists: await ledger.browseRemove(String(id || '')) });
        }
        if (path === '/staff/browse-seed' && request.method === 'POST') {
          // Looks each name up on Spotify and adds the exact-name match. Names with no exact match are reported, not guessed.
          const { names } = await request.json();
          const found = [], missing = [];
          await Promise.all((Array.isArray(names) ? names : []).slice(0, 8).map(async n => {
            const name = String(n || '').replace(/"/g, '').trim().slice(0, 100);
            if (name.length < 2) return;
            const data = await (await spotify(env, `/search?q=${encodeURIComponent(name)}&type=artist&limit=5`)).json();
            const a = pickArtist(data.artists?.items || [], name);
            if (!a) { missing.push(name); return; }
            found.push({ id: a.id, name: a.name, image: a.images?.[2]?.url || a.images?.[0]?.url || '', genre: (a.genres || [])[0] || '' });
          }));
          if (found.length) await ledger.browseAdd(found);
          return json({ ok: true, added: found.length, missing });
        }
        if (path === '/staff/table-key') return json({ key: await tableKey(env, await ledger.tableEpoch()) });
        if (path === '/staff/rotate-table' && request.method === 'POST') return json({ ok: true, epoch: await ledger.rotateTable() });
        if (path === '/staff/blocked') { const l = await ledger.blockLists(); return json({ blocked: l.artists, blockedTracks: l.tracks }); }
        if (path === '/staff/block-artists' && request.method === 'POST') {
          const { artists } = await request.json();
          const ok = (Array.isArray(artists) ? artists : []).slice(0, 80).filter(a => /^[A-Za-z0-9]{10,40}$/.test(a.id || '')).map(a => ({ id: a.id, name: String(a.name || '').slice(0, 100) }));
          if (!ok.length) return json({ error: 'Nothing to block' }, 400);
          return json({ ok: true, blocked: await ledger.blockMany(ok) });
        }
        if (path === '/staff/lookup-artists' && request.method === 'POST') {
          // Finds likely Spotify artists for pasted names. Saves nothing.
          const { names } = await request.json();
          const out = [];
          for (const n of (Array.isArray(names) ? names : []).slice(0, 10)) {
            const q = String(n || '').replace(/"/g, '').trim().slice(0, 100);
            if (q.length < 2) { out.push({ name: q, matches: [] }); continue; }
            const data = await (await spotify(env, `/search?q=${encodeURIComponent(q)}&type=artist&limit=4`)).json();
            out.push({ name: q, matches: (data.artists?.items || []).slice(0, 4).map(a => ({ id: a.id, name: a.name, genre: (a.genres || [])[0] || '' })) });
          }
          return json({ results: out });
        }
        if (path === '/staff/block-tracks' && request.method === 'POST') {
          const { tracks } = await request.json();
          const entries = [];
          for (const t of (Array.isArray(tracks) ? tracks : []).slice(0, 60)) {
            const ids = (t.artists || []).map(a => a.id).filter(id => /^[A-Za-z0-9]{10,40}$/.test(id || ''));
            if (!TRACK_URI.test(t.uri || '') || !ids.length) continue;
            entries.push({ uri: t.uri, title: normTitle(t.name), name: String(t.name || '').slice(0, 150), artist: (t.artists || []).map(a => String(a.name || '')).join(', ').slice(0, 150), artistIds: ids });
          }
          if (!entries.length) return json({ error: 'Nothing to block' }, 400);
          return json({ ok: true, blockedTracks: await ledger.blockTracks(entries) });
        }
        if (path === '/staff/unblock-track' && request.method === 'POST') {
          const { uri } = await request.json();
          return json({ ok: true, blockedTracks: await ledger.unblockTrack(String(uri || '')) });
        }
        if (path === '/staff/lookup' && request.method === 'POST') {
          // Finds the likely Spotify matches for pasted "song / artist" pairs. Saves nothing.
          const { lines } = await request.json();
          const out = [];
          for (const l of (Array.isArray(lines) ? lines : []).slice(0, 8)) {
            const name = String(l.name || '').slice(0, 150), artist = String(l.artist || '').slice(0, 100);
            const short = name.replace(/[\(\[].*?[\)\]]/g, ' ').replace(/\s[-–—]\s.*$/, '').replace(/["]/g, '').replace(/\s+/g, ' ').trim() || name;
            const a = artist.replace(/["]/g, '').trim();
            const find = async q => (await (await spotify(env, `/search?q=${encodeURIComponent(q)}&type=track&limit=5`)).json()).tracks?.items || [];
            let items = await find(`track:"${short}" artist:"${a}"`);
            if (!items.length) items = await find(`${short} ${a}`);
            out.push({ name, artist, matches: items.slice(0, 4).map(trackShape) });
          }
          return json({ results: out });
        }
        if (path === '/staff/block' && request.method === 'POST') {
          const { id, name } = await request.json();
          if (!/^[A-Za-z0-9]{10,40}$/.test(id || '')) return json({ error: 'Bad artist' }, 400);
          return json({ ok: true, blocked: await ledger.block({ id, name: String(name || '').slice(0, 100) }) });
        }
        if (path === '/staff/unblock' && request.method === 'POST') {
          const { id } = await request.json();
          return json({ ok: true, blocked: await ledger.unblock(String(id || '')) });
        }
        if (path === '/staff/artists') return json({ artists: await ledger.artistsPlayed(60) });
        if (path === '/staff/search-artists') return json({ items: await artistSearch(env, url.searchParams.get('q')) });
        if (path === '/staff/search') return json({ items: await trackSearch(env, url.searchParams) });
      }

      return json({ error: 'Unknown endpoint' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
