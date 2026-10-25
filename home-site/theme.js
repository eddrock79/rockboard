// Shared by the phone page, the TV board and the staff page.
(function () {
  const T = {
    classic: { name: 'Classic green', sub: 'HOME SWEET HOME', tag: 'PICK A TUNE · IT’S ALL FREE' },
    gothic:  { name: 'Gothic', sub: '† CHERYL’S CATHEDRAL †', tag: 'CHOOSE YOUR RITUAL · ALL FREE' },
  };
  window.JTHEMES = T;
  window.applyTheme = function (name) {
    if (!T[name]) name = 'classic';
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem('ej_theme', name); } catch (e) {}
    document.querySelectorAll('[data-tx]').forEach(el => { const v = T[name][el.dataset.tx]; if (v) el.textContent = v; });
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = name === 'gothic' ? '#08040b' : '#050706';
  };
  let saved = 'classic'; try { saved = localStorage.getItem('ej_theme') || 'classic'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', T[saved] ? saved : 'classic');
  document.addEventListener('DOMContentLoaded', () => window.applyTheme(document.documentElement.getAttribute('data-theme')));
})();
