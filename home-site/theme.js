// Shared by the phone page, the TV board and the staff page.
(function () {
  const T = {
    classic: { name: 'Classic green', sub: 'HOME SWEET HOME', tag: 'PICK A TUNE · IT’S ALL FREE' },
    gothic:  { name: 'Ghost', sub: 'CHERYL’S CATHEDRAL', tag: 'CHOOSE YOUR RITUAL · ALL FREE' },
  };
  window.JTHEMES = T;
  // Decoration only. Build once: live state reapplies the theme every few seconds.
  function addIdentity() {
    const host = document.querySelector('#logo, .brand') || document.querySelector('.wrap > h1');
    if (!host || document.querySelector('.ritual-identity')) return;
    const identity = document.createElement('div');
    identity.className = 'ritual-identity';
    identity.innerHTML = '<div class="ritual-eyebrow">EDD &amp; CHERYL PRESENT</div>' +
      '<img class="ritual-wordmark" src="assets/ghost-wordmark.webp" alt="Ghost" width="500" height="274">' +
      '<div class="ritual-caption">' + (host.tagName === 'H1' ? 'THE HOUSE CONTROLS' : 'THE HOME RITUAL') + '</div>';
    if (host.tagName === 'H1') {
      host.classList.add('ritual-admin-heading');
      host.before(identity);
    } else host.prepend(identity);
  }
  window.applyTheme = function (name) {
    if (!T[name]) name = 'classic';
    const changed = document.documentElement.dataset.theme !== name;
    if (name === 'gothic') addIdentity();
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem('ej_theme', name); } catch (e) {}
    document.querySelectorAll('[data-tx]').forEach(el => { const v = T[name][el.dataset.tx]; if (v) el.textContent = v; });
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = name === 'gothic' ? '#08040b' : '#050706';
    if (changed) window.dispatchEvent(new CustomEvent('jukeboxthemechange'));
  };
  let saved = 'classic'; try { saved = localStorage.getItem('ej_theme') || 'classic'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', T[saved] ? saved : 'classic');
  document.addEventListener('DOMContentLoaded', () => window.applyTheme(document.documentElement.getAttribute('data-theme')));
})();
