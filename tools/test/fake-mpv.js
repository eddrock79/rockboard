// Test stand-in for mpv: honours --input-ipc-server, answers get_property time-pos and set_property pause.
const net = require('net'), fs = require('fs');
const args = process.argv.slice(2);
const ipc = (args.find(a => a.startsWith('--input-ipc-server=')) || '').split('=')[1];
const file = args[args.length - 1];
if (!fs.existsSync(file)) process.exit(2);
const total = Number(process.env.FAKE_SECONDS || 6) * 1000;
let pos = 0, paused = false, last = Date.now();
const tick = setInterval(() => { const n = Date.now(); if (!paused) pos += n - last; last = n; if (pos >= total) { clearInterval(tick); process.exit(0); } }, 100);
try { fs.unlinkSync(ipc); } catch (e) {}
net.createServer(s => {
  let b = '';
  s.on('data', d => { b += d; let i; while ((i = b.indexOf('\n')) >= 0) { const m = JSON.parse(b.slice(0, i)); b = b.slice(i + 1);
    const [c, p, v] = m.command; let data = null;
    if (c === 'get_property' && p === 'time-pos') data = pos / 1000;
    if (c === 'set_property' && p === 'pause') paused = v;
    s.write(JSON.stringify({ request_id: m.request_id, error: 'success', data }) + '\n'); } });
}).listen(ipc);
