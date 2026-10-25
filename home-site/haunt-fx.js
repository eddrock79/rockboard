// Haunt effects for the TV board, ported from the What's On board.
//  1. Text twitch: every 10-30 s one piece of text jitters and skews with ghost copies of its letters.
//  2. Backdrop tear: every few minutes a short burst of static and a judder, in the backdrop picture only.
// ?haunt=off on the board address turns both off (it remembers); ?haunt=on turns them back on.
(function () {
  try { const q = new URLSearchParams(location.search).get('haunt'); if (q) localStorage.setItem('ej_haunt', q); if (localStorage.getItem('ej_haunt') === 'off') return; } catch (e) {}
  const css = document.createElement('style');
  css.textContent = `
  :root { --gh1:100,228,190; --gh2:220,50,30; }
  html[data-theme="gothic"] { --gh1:226,181,96; --gh2:170,24,70; }
  .haunt-twitch { display:inline-block; position:relative; animation:hauntTextTwitch .72s steps(1,end); will-change:transform,filter,opacity; text-shadow:none!important; }
  .haunt-twitch::before, .haunt-twitch::after { content:attr(data-haunt-text); position:absolute; left:0; top:0; opacity:0; pointer-events:none; mix-blend-mode:screen; white-space:inherit; }
  .haunt-twitch::before { color:rgba(var(--gh1),.85); transform:translate(-5px,-2px); animation:hauntGhostA .72s steps(1,end); }
  .haunt-twitch::after { color:rgba(var(--gh2),.78); transform:translate(6px,2px); animation:hauntGhostB .72s steps(1,end); }
  @keyframes hauntTextTwitch {
    0%,100% { transform:none; filter:none; opacity:1 }
    8% { transform:translateX(-2px) skewX(-1deg); filter:blur(.3px); opacity:.88 }
    11% { transform:translateX(12px) skewX(9deg); filter:blur(1.2px) contrast(1.4); opacity:.45 }
    13% { transform:translateX(-8px) skewX(-6deg); filter:blur(.6px); opacity:.92 }
    15% { transform:none; filter:hue-rotate(180deg) contrast(1.2) }
    20% { transform:none; filter:none }
    42% { transform:translateX(3px); opacity:.72; filter:blur(.2px) }
    45% { transform:translateX(-14px) skewX(-10deg); filter:blur(1.8px) contrast(1.6); opacity:.28 }
    47% { transform:translateX(7px) skewX(5deg); opacity:.88; filter:blur(.4px) }
    50% { transform:none; filter:none; opacity:1 }
    65% { transform:translateX(-1px); filter:blur(.1px) brightness(.92); opacity:.96 }
    68% { transform:translateX(8px) skewX(6deg); filter:blur(.9px) contrast(1.3); opacity:.52 }
    70% { transform:none; filter:none; opacity:1 }
  }
  @keyframes hauntGhostA { 0%,8%,20%,42%,52%,100% { opacity:0 } 9%,14%,43%,49% { opacity:.78 } }
  @keyframes hauntGhostB { 0%,11%,22%,45%,55%,100% { opacity:0 } 12%,17%,46%,52% { opacity:.68 } }`;
  document.head.appendChild(css);

  const TARGETS = '#title, #artist, #pickL h2, #npHead b, #qHead b, #topHead, .row .t, .row .a, .tr em, #sub b';
  function twitch() {
    const els = [...document.querySelectorAll(TARGETS)].filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 12 && r.height > 8 && (el.textContent || '').trim().length > 1 && getComputedStyle(el).visibility !== 'hidden';
    });
    if (!els.length) return;
    const el = els[Math.floor(Math.random() * els.length)];
    if (el.classList.contains('haunt-twitch')) return;
    el.dataset.hauntText = (el.textContent || '').trim();
    el.classList.add('haunt-twitch');
    setTimeout(() => { el.classList.remove('haunt-twitch'); delete el.dataset.hauntText; }, 700);
  }

  // rare static + judder, backdrop picture only
  const bg = document.getElementById('bgart');
  let canvas, ctx, img, timer;
  function tear() {
    if (!bg || !bg.classList.contains('on') || getComputedStyle(bg).display === 'none') return;
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 280;
      canvas.style.cssText = 'position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);z-index:0;pointer-events:none;image-rendering:pixelated;mix-blend-mode:screen;opacity:0;transition:opacity .1s;animation:drift 45s ease-in-out infinite';
      bg.parentNode.insertBefore(canvas, bg.nextSibling);
      ctx = canvas.getContext('2d'); img = ctx.createImageData(160, 280);
    }
    const end = Date.now() + 520 + Math.random() * 280, tearY = Math.random() * 220;
    clearInterval(timer);
    timer = setInterval(() => {
      if (Date.now() > end) { clearInterval(timer); canvas.style.opacity = 0; bg.style.translate = ''; return; }
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() < .3 ? 120 + Math.random() * 135 : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, tearY + (Math.random() * 6 - 3), 160, 2 + Math.random() * 7);
      canvas.style.opacity = .3;
      bg.style.translate = ((Math.random() * 2 - 1) * 20).toFixed(1) + 'px 0';
    }, 80);
  }

  function loop(fn, minMs, maxMs, firstMin, firstMax) {
    setTimeout(() => { fn(); loop(fn, minMs, maxMs); }, firstMin + Math.random() * (firstMax - firstMin));
  }
  loop(twitch, 10000, 30000, 6000, 16000);
  loop(tear, 120000, 300000, 60000, 140000);
  window.__haunt = { twitch, tear };
})();
