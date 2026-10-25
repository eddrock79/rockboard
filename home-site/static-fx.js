// Old-TV interference, applied to the backdrop picture only (text and the rest of the board stay clean).
// Faint grain all the time, now and then a burst of static with a tear through the picture.
// Change it with ?fx=off | subtle | strong on the board address (it remembers your choice).
(function () {
  let mode = 'subtle';
  try { const q = new URLSearchParams(location.search).get('fx'); if (q) localStorage.setItem('ej_fx', q); mode = localStorage.getItem('ej_fx') || 'subtle'; } catch (e) {}
  if (mode === 'off') return;
  const strong = mode === 'strong';
  const bg = document.getElementById('bgart'); if (!bg) return;
  const c = document.createElement('canvas'); c.id = 'bgfx'; c.width = 160; c.height = 280;
  c.style.cssText = 'position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);z-index:0;pointer-events:none;image-rendering:pixelated;mix-blend-mode:screen;opacity:0;transition:opacity .12s;animation:drift 45s ease-in-out infinite';
  bg.parentNode.insertBefore(c, bg.nextSibling);
  const ctx = c.getContext('2d'), img = ctx.createImageData(c.width, c.height);
  let burstUntil = 0, tearY = 0, nextBurst = Date.now() + 5000 + Math.random() * 12000;
  function noise(level, bright) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() < level ? bright * (.45 + Math.random() * .55) : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }
  function frame() {
    const shown = bg.classList.contains('on') && getComputedStyle(bg).display !== 'none';
    const now = Date.now(), inBurst = now < burstUntil;
    if (!shown) { c.style.opacity = 0; bg.style.translate = ''; return; }
    if (!inBurst && now > nextBurst) {
      burstUntil = now + 250 + Math.random() * (strong ? 800 : 450);
      nextBurst = burstUntil + (strong ? 4000 : 10000) + Math.random() * (strong ? 14000 : 35000);
      tearY = Math.random() * c.height * .8;
    }
    if (inBurst) {
      noise(strong ? .45 : .26, 255);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(0, tearY + (Math.random() * 6 - 3), c.width, 2 + Math.random() * 8);
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(0, (tearY + 90 + Math.random() * 60) % c.height, c.width, 1 + Math.random() * 3);
      c.style.opacity = strong ? .6 : .34;
      bg.style.translate = ((Math.random() * 2 - 1) * (strong ? 36 : 18)).toFixed(1) + 'px 0'; // the picture itself judders
    } else {
      noise(.5, 255);
      c.style.opacity = strong ? .16 : .1;
      bg.style.translate = '';
    }
  }
  setInterval(frame, 90);
  window.__fxBurst = () => { burstUntil = Date.now() + 600; };
})();
