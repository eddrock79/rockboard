// Old-TV interference for the board: faint grain all the time, an occasional burst of static with a screen tear.
// Change it with ?fx=off | subtle | strong on the board address (it remembers your choice).
(function () {
  let mode = 'subtle';
  try { const q = new URLSearchParams(location.search).get('fx'); if (q) localStorage.setItem('ej_fx', q); mode = localStorage.getItem('ej_fx') || 'subtle'; } catch (e) {}
  if (mode === 'off') return;
  const strong = mode === 'strong';
  const stage = document.getElementById('stage'); if (!stage) return;
  const c = document.createElement('canvas'); c.id = 'fx'; c.width = 200; c.height = 200;
  c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:50;pointer-events:none;image-rendering:pixelated;mix-blend-mode:screen;opacity:.05;transition:opacity .08s';
  stage.appendChild(c);
  const ctx = c.getContext('2d'), img = ctx.createImageData(200, 200);
  let burstUntil = 0, tearY = 0, nextBurst = Date.now() + 6000 + Math.random() * 14000;
  const logo = document.getElementById('logo');
  function noise(level) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() < level ? 120 + Math.random() * 135 : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }
  function frame() {
    const now = Date.now(), inBurst = now < burstUntil;
    if (!inBurst && now > nextBurst) {
      burstUntil = now + 220 + Math.random() * (strong ? 700 : 420);
      nextBurst = burstUntil + (strong ? 5000 : 12000) + Math.random() * (strong ? 15000 : 40000);
      tearY = Math.random() * 180;
    }
    if (inBurst) {
      noise(strong ? .5 : .28);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, tearY + (Math.random() * 6 - 3), 200, 2 + Math.random() * 7);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, (tearY + 70 + Math.random() * 40) % 200, 200, 1 + Math.random() * 3);
      c.style.opacity = strong ? .45 : .2;
      stage.style.transform = stage.style.transform.replace(/ translateX\([^)]*\)/, '') + ' translateX(' + ((Math.random() * 2 - 1) * (strong ? 10 : 5)).toFixed(1) + 'px)';
      if (logo) logo.style.textShadow = '3px 0 rgba(255,40,80,.7), -3px 0 rgba(40,220,255,.7)';
    } else {
      noise(.5);
      c.style.opacity = strong ? .09 : .05;
      stage.style.transform = stage.style.transform.replace(/ translateX\([^)]*\)/, '');
      if (logo) logo.style.textShadow = '';
    }
  }
  setInterval(frame, 90);
  window.__fxBurst = () => { burstUntil = Date.now() + 500; }; // for testing
})();
