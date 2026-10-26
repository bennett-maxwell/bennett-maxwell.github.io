/* FranchiseKI /brands/ filters: category, investment band, territory, state. */
(function () {
  var grid = document.getElementById('browse-grid');
  if (!grid) return;
  var els = { cat: document.getElementById('f-cat'), band: document.getElementById('f-band'),
              terr: document.getElementById('f-terr'), state: document.getElementById('f-state'),
              count: document.getElementById('f-count'), clear: document.getElementById('f-clear') };
  var bySlug = {};
  function bandOk(b, band) {
    if (!band) return true;
    if (b.investmentMin == null) return false;
    var m = b.investmentMin;
    if (band === 'lt100') return m < 100000;
    if (band === '100-250') return m >= 100000 && m < 250000;
    if (band === '250-500') return m >= 250000 && m < 500000;
    if (band === '500-1m') return m >= 500000 && m < 1000000;
    if (band === '1mplus') return m >= 1000000;
    return true;
  }
  function apply() {
    var cat = els.cat.value, band = els.band.value, terr = els.terr.value, st = els.state.value;
    var shown = 0;
    grid.querySelectorAll('.card').forEach(function (card) {
      var b = bySlug[card.getAttribute('data-slug')];
      var ok = true;
      if (b) {
        if (cat && b.category !== cat) ok = false;
        if (ok && !bandOk(b, band)) ok = false;
        if (ok && terr && (b.territoryType || 'unknown') !== terr) ok = false;
        if (ok && st && !(b.item20States && b.item20States.indexOf(st) >= 0)) ok = false;
      } else if (cat || band || terr || st) { ok = false; }
      card.style.display = ok ? '' : 'none';
      if (ok) shown += 1;
    });
    els.count.textContent = shown.toLocaleString('en-US') + ' brands shown';
  }
  fetch('/match-index.json').then(function (r) { return r.json(); }).then(function (d) {
    d.forEach(function (b) { bySlug[b.slug] = b; });
    ['cat', 'band', 'terr', 'state'].forEach(function (k) {
      els[k].addEventListener('change', apply);
    });
    els.clear.addEventListener('click', function () {
      els.cat.value = ''; els.band.value = ''; els.terr.value = ''; els.state.value = ''; apply();
    });
    apply();
  }).catch(function () { els.count.textContent = 'Filter data could not be loaded \u2014 the full list is shown.'; });
})();
