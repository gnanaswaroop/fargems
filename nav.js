/* FarGems: a Back link goes back to the page the visitor came from (the sky view, settings, or the home page) when there
 * is one on this site, and otherwise follows its own address. Links marked data-back are handled. */
(() => {
  'use strict';
  document.querySelectorAll('a[data-back]').forEach((a) => {
    a.addEventListener('click', (e) => {
      try {
        if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { e.preventDefault(); history.back(); }
      } catch { /* follow the link */ }
    });
  });
})();
