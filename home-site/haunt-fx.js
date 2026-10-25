// Haunt effects for the TV board, ported from the What's On board.
//  1. Letter glitch: every 9-24 s ONE letter somewhere on the board swaps for a moment and slips a pixel or two.
//  2. Backdrop tear: every few minutes a short burst of static and a judder, in the backdrop picture only.
// ?haunt=off on the board address turns both off (it remembers); ?haunt=on turns them back on.
(function () {
  try { const q = new URLSearchParams(location.search).get('haunt'); if (q) localStorage.setItem('ej_haunt', q); if (localStorage.getItem('ej_haunt') === 'off') return; } catch (e) {}
  const TARGETS = '#title, #artist, #pickL h2, #npHead b, #qHead b, #topHead, .row .t, .row .a, .tr em, #sub b';
  const UP = 'ABCDEFGHKMNORSTUVWXZ#%&@?/', LOW = 'abcdeghkmnoprstuvwxz#%&?/';
  const css = document.createElement('style');
  css.textContent = ':root{--gh1:100,228,190;--gh2:220,50,30} html[data-theme="gothic"]{--gh1:226,181,96;--gh2:170,24,70}';
  document.head.appendChild(css);

  // One letter, briefly: it swaps to other characters and slips a pixel or two, then goes back. Nothing else moves.
  let busy = false;
  function glitchLetter() {
    if (busy) return;
    const els = [...document.querySelectorAll(TARGETS)].filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 12 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden';
    });
    if (!els.length) return;
    const el = els[Math.floor(Math.random() * els.length)];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/[A-Za-z]/.test(n.nodeValue) && !n.parentNode.closest('.hz')) nodes.push(n);
    if (!nodes.length) return;
    const node = nodes[Math.floor(Math.random() * nodes.length)], text = node.nodeValue;
    const idxs = []; for (let i = 0; i < text.length; i++) if (/[A-Za-z]/.test(text[i])) idxs.push(i);
    const i = idxs[Math.floor(Math.random() * idxs.length)], ch = text[i];
    const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
    const w = range.getBoundingClientRect().width, scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
    const span = document.createElement('span'); span.className = 'hz'; span.textContent = ch;
    span.style.cssText = 'display:inline-block;text-align:center;overflow:visible;width:' + (w / scale).toFixed(2) + 'px;white-space:pre';
    const after = node.splitText(i + 1), mid = node.splitText(i); // node = before, mid = the letter, after = rest
    mid.parentNode.replaceChild(span, mid);
    busy = true;
    const pool = ch === ch.toUpperCase() ? UP : LOW;
    let frames = 0; const total = 5 + Math.floor(Math.random() * 4);
    const t = setInterval(() => {
      frames++;
      if (!span.isConnected) { clearInterval(t); busy = false; return; }
      if (frames > total) {
        clearInterval(t); span.textContent = ch; span.style.transform = ''; span.style.textShadow = '';
        try { const p = span.parentNode; p.replaceChild(document.createTextNode(ch), span); p.normalize(); } catch (e) {}
        busy = false;
        return;
      }
      span.textContent = Math.random() < .35 ? ch : pool[Math.floor(Math.random() * pool.length)];
      span.style.transform = 'translate(' + ((Math.random() * 3 - 1.5)).toFixed(1) + 'px,' + ((Math.random() * 2 - 1)).toFixed(1) + 'px)';
      span.style.textShadow = Math.random() < .5 ? '-1.5px 0 rgba(var(--gh1),.8), 1.5px 0 rgba(var(--gh2),.7)' : '';
    }, 70);
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

  function loop(fn, minMs, maxMs, firstMin = minMs, firstMax = maxMs) {
    setTimeout(() => { fn(); loop(fn, minMs, maxMs); }, firstMin + Math.random() * (firstMax - firstMin));
  }
  loop(glitchLetter, 9000, 24000, 7000, 16000);
  loop(tear, 120000, 300000, 60000, 140000);
  window.__haunt = { glitchLetter, tear };
})();
