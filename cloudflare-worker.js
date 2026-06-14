const CORS_HEADERS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    async function getAccessToken() {
      const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
      const res = await fetch('https://accounts.spotify.com/api/token', {method:'POST',headers:{'Authorization':`Basic ${credentials}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:env.SPOTIFY_REFRESH_TOKEN})});
      const data = await res.json();
      if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
      return data.access_token;
    }
    function json(data, status=200) { return new Response(JSON.stringify(data), {status, headers:{...CORS_HEADERS,'Content-Type':'application/json'}}); }
    try {
      if (path === '/search') {
        const token  = await getAccessToken();
        const track  = url.searchParams.get('track')  || '';
        const artist = url.searchParams.get('artist') || '';

        async function trySearch(t, a) {
          const qStr = a ? `track:${t} artist:${a}` : `track:${t}`;
          const res  = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(qStr)}&type=track&limit=5`,
            {headers:{'Authorization':`Bearer ${token}`}}
          );
          const data = await res.json();
          const items = data.tracks?.items || [];
          if (!items.length) return null;
          const exact = items.find(i => i.name.toLowerCase() === t.toLowerCase());
          return exact || items[0];
        }

        // Normalise artist — add spaces before capitals e.g. "Greenday" -> "Green Day"
        // and strip common suffixes
        const normArtist = artist
          .replace(/([a-z])([A-Z])/g, '$1 $2')  // GreenDay -> Green Day
          .replace(/\s+/g, ' ')
          .trim();

        let item = null;

        async function tryKeyword(t, a) {
          // Broad keyword search — no field filters
          const q = a ? `${t} ${a}` : t;
          const res = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5`,
            {headers:{'Authorization':`Bearer ${token}`}}
          );
          const data = await res.json();
          const items = data.tracks?.items || [];
          if (!items.length) return null;
          // Prefer exact title + artist match
          const exact = items.find(i =>
            i.name.toLowerCase() === t.toLowerCase() &&
            i.artists.some(ar => ar.name.toLowerCase().includes(a.toLowerCase().split(' ')[0]))
          );
          return exact || items.find(i => i.name.toLowerCase() === t.toLowerCase()) || items[0];
        }

        // Try progressively looser searches
        // First try strict field filters, then fall back to keyword search
        const searches = [
          [track, artist],           // exact as typed
          [track, normArtist],       // normalised artist
          [track, ''],               // title only (strict)
        ];

        for (const [t, a] of searches) {
          item = await trySearch(t, a);
          if (item) break;
        }

        // If strict searches failed, try broad keyword searches
        if (!item) {
          const kwSearches = [
            [track, normArtist],
            [track, artist],
            [track, ''],
          ];
          for (const [t, a] of kwSearches) {
            item = await tryKeyword(t, a);
            if (item) break;
          }
        }

        if (!item) return json({error:'Track not found'},404);
        return json({uri:item.uri,name:item.name,artist:item.artists[0].name,album:item.album.name,image:item.album.images[0]?.url||'',duration:item.duration_ms});
      }
      if (path === '/add' && request.method === 'POST') {
        const {uri} = await request.json();
        if (!uri) return json({error:'No URI'},400);
        const token = await getAccessToken();
        const res = await fetch(`https://api.spotify.com/v1/playlists/${env.SPOTIFY_PLAYLIST_ID}/tracks`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({uris:[uri]})});
        const data = await res.json();
        return data.snapshot_id ? json({ok:true}) : json({error:data},400);
      }
      if (path === '/remove' && request.method === 'POST') {
        const {uri} = await request.json();
        if (!uri) return json({error:'No URI'},400);
        const token = await getAccessToken();
        await fetch(`https://api.spotify.com/v1/playlists/${env.SPOTIFY_PLAYLIST_ID}/tracks`,{method:'DELETE',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({tracks:[{uri}]})});
        return json({ok:true});
      }
      if (path === '/queue' && request.method === 'POST') {
        const {uri} = await request.json();
        if (!uri) return json({error:'No URI'},400);
        const token = await getAccessToken();
        const res = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`,{method:'POST',headers:{'Authorization':`Bearer ${token}`}});
        // Spotify returns 204 (no content) on success, but sometimes 200
        if (res.status === 204 || res.status === 200) return json({ok:true});
        const errData = await res.json().catch(()=>({status:res.status}));
        return json({ok:false, status:res.status, error:errData, uri:uri});
      }
      if (path === '/nowplaying') {
        const token = await getAccessToken();
        const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing',{headers:{'Authorization':`Bearer ${token}`}});
        if (res.status === 204) return json({playing:false});
        const data = await res.json();
        return json({playing:data.is_playing,uri:data.item?.uri,name:data.item?.name,artist:data.item?.artists?.[0]?.name,progress:data.progress_ms,duration:data.item?.duration_ms,image:data.item?.album?.images?.[0]?.url||''});
      }
      if (path === '/playlist') {
        const token = await getAccessToken();
        const res = await fetch(`https://api.spotify.com/v1/playlists/${env.SPOTIFY_PLAYLIST_ID}/tracks?limit=50`,{headers:{'Authorization':`Bearer ${token}`}});
        const data = await res.json();
        return json({tracks:(data.items||[]).map(i=>({uri:i.track?.uri,name:i.track?.name,artist:i.track?.artists?.[0]?.name}))});
      }
      if (path === '/ping') {
        return json({ ok: true, hasApiKey: !!env.ANTHROPIC_API_KEY, ts: Date.now() });
      }
      if (path === '/ai-quotes' && request.method === 'POST') {
        const body = await request.json();
        const prompt = body.prompt || '';
        if (!prompt) return json({error:'No prompt'},400);
        if (!env.ANTHROPIC_API_KEY) return json({error:'No API key configured'},500);

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model:      'claude-sonnet-4-6',
            max_tokens: 800,
            messages:   [{ role: 'user', content: prompt }],
          }),
        });

        const data = await res.json();
        if (!res.ok) return json({error: data.error?.message || 'API error'}, res.status);
        return json(data);
      }

      return json({error:'Unknown endpoint'},404);
    } catch(e) { return json({error:e.message},500); }
  }
};