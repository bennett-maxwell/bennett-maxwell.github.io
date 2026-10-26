/* FranchiseKI brand comparison: selection tray (all pages) + table (/compare/). */
(function () {
  var KEY = 'fki-compare', MAX = 3, ND = 'Not disclosed in the FDD';
  var AVAIL_LABEL = "Most likely available — no existing or announced outlets here, based on the brand's latest FDD (Item 20). Only the franchisor can confirm availability.";
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function has(sel, slug) { return sel.some(function (x) { return x.slug === slug; }); }
  function toast(msg) {
    var t = document.getElementById('cmptoast');
    if (!t) { t = document.createElement('div'); t.id = 'cmptoast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 2600);
  }
  function ensureTray() {
    var tr = document.getElementById('cmptray');
    if (!tr) {
      tr = document.createElement('div'); tr.id = 'cmptray';
      tr.innerHTML = '<div class="cmptray-in"><span class="cmptray-names"></span>' +
        '<a class="cmptray-go" href="/compare/">Compare now \u2192</a>' +
        '<button id="cmptray-clear" type="button">Clear</button></div>';
      document.body.appendChild(tr);
      tr.querySelector('#cmptray-clear').addEventListener('click', function () { setSel([]); });
    }
    return tr;
  }
  function renderTray(sel) {
    var t = document.getElementById('cmptray');
    if (!sel.length) { if (t) t.classList.remove('show'); return; }
    var tr = ensureTray();
    tr.querySelector('.cmptray-names').textContent =
      'Comparing (' + sel.length + '/' + MAX + '): ' + sel.map(function (x) { return x.name; }).join('  \u00B7  ');
    tr.classList.add('show');
  }
  function syncBoxes(sel) {
    document.querySelectorAll('.cmp-add').forEach(function (b) {
      b.checked = has(sel, b.getAttribute('data-slug'));
    });
  }
  var onChange = null; /* set by the /compare/ page logic once its data loads */
  function setSel(sel) { save(sel); syncBoxes(sel); renderTray(sel); if (onChange) onChange(sel); }
  function toggle(slug, name, want) {
    var sel = load();
    if (want) {
      if (has(sel, slug)) return;
      if (sel.length >= MAX) { toast('You can compare up to 3 brands \u2014 remove one first.'); syncBoxes(sel); return; }
      sel.push({ slug: slug, name: name || slug });
    } else {
      sel = sel.filter(function (x) { return x.slug !== slug; });
    }
    setSel(sel);
  }
  document.addEventListener('change', function (e) {
    var b = e.target;
    if (b && b.classList && b.classList.contains('cmp-add')) {
      toggle(b.getAttribute('data-slug'), b.getAttribute('data-name'), b.checked);
    }
  });
  document.addEventListener('DOMContentLoaded', function () {
    var s = load(); syncBoxes(s); renderTray(s);
  });

  /* ---------------- /compare/ page ---------------- */
  var wrap = document.getElementById('cmp-wrap');
  if (wrap) initCompare();
  function initCompare() {
    var idx = null, bySlug = {};
    function nd() { return '<span class="nd">' + ND + '</span>'; }
    function cell(v) { return (v === null || v === undefined || v === '') ? nd() : v; }
    function availCell(e) {
      if (!e.tt) return null;
      if (e.tt === 'exclusive' || e.tt === 'protected') {
        if (e.empty && e.empty.length) {
          return '<span class="lbl">' + AVAIL_LABEL + '</span><br>States with no existing or announced outlets: ' + e.empty.join(', ');
        }
        if (e.empty) {
          return 'This brand discloses existing or announced outlets in every state, so no state carries the \u201Cmost likely available\u201D label. Areas inside an existing franchisee\u2019s territory are not available while that agreement runs.';
        }
        return 'No state list can be computed for this brand yet \u2014 its FDD outlet table (Item 20) has not been extracted. Areas inside an existing franchisee\u2019s territory are not available while that agreement runs.';
      }
      if (e.tt === 'non-exclusive') {
        return 'This brand grants no exclusive territory, so no area is reserved for \u2014 or closed by \u2014 another franchisee. Whether a new unit is placed anywhere is the franchisor\u2019s decision under Item 12.';
      }
      return 'This brand grants no territory at all. Where you may operate is the franchisor\u2019s decision; there are no territory-based exclusions.';
    }
    function render(sel) {
      if (!idx) return;
      sel = sel.filter(function (x) { return bySlug[x.slug]; });
      if (!sel.length) {
        wrap.innerHTML = '<p class="note">You have not picked any brands yet. Tick <b>Compare</b> on any brand card or brand page (up to 3), or use the search above to add brands directly.</p>';
        return;
      }
      var rows = [
        ['Category', function (e) { return e.cat ? escHtml(e.cat) : null; }],
        ['Franchise fee (Item 5)', function (e) { return e.fee; }],
        ['Total investment (Item 7)', function (e) { return e.inv; }],
        ['Royalty (Item 6)', function (e) { return e.roy; }],
        ['Franchised units (Item 20)', function (e) { return (e.units === null || e.units === undefined) ? null : e.units.toLocaleString('en-US'); }],
        ['Territory rule (Item 12)', function (e) {
          if (!e.tt) return null;
          return '<b>' + escHtml(e.tlabel) + '</b>' + (e.cit ? '<br><span class="small">Classified from ' + escHtml(e.cit) + ' of the brand\u2019s FDD</span>' : '');
        }],
        ['The FDD\u2019s own words (Item 12)', function (e) {
          return e.i12 ? '<span class="i12">\u201C' + escHtml(e.i12) + '\u201D</span>' : null;
        }],
        ['Availability', availCell]
      ];
      var h = '<table class="compare"><tr><td></td>';
      sel.forEach(function (x) {
        var e = bySlug[x.slug];
        h += '<th>' + escHtml(e.name) + ' <button class="cmp-rm" type="button" data-rm="' + e.slug + '" title="Remove from comparison">\u00D7</button><br><a href="/brands/' + e.slug + '/">Full profile \u2192</a></th>';
      });
      h += '</tr>';
      rows.forEach(function (row) {
        h += '<tr><td>' + row[0] + '</td>';
        sel.forEach(function (x) { h += '<td>' + cell(row[1](bySlug[x.slug])) + '</td>'; });
        h += '</tr>';
      });
      h += '</table>';
      h += '<p class="note">Every figure is as disclosed in each brand\u2019s own FDD. Where the FDD does not disclose a figure, the cell says \u201C' + ND + '\u201D \u2014 FranchiseKI never estimates a brand\u2019s numbers.</p>';
      wrap.innerHTML = h;
      wrap.querySelectorAll('[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () { toggle(b.getAttribute('data-rm'), '', false); });
      });
    }
    var q = document.getElementById('cmp-q'), pick = document.getElementById('cmp-pick');
    function renderPick() {
      if (!idx || !q || !pick) return;
      var s = q.value.trim().toLowerCase(), sel = load();
      if (s.length < 2) { pick.innerHTML = ''; return; }
      var hits = idx.filter(function (e) { return e.name.toLowerCase().indexOf(s) >= 0; }).slice(0, 12);
      pick.innerHTML = hits.map(function (e) {
        var dis = (has(sel, e.slug) || sel.length >= MAX) ? ' disabled' : '';
        return '<button type="button" data-add="' + e.slug + '"' + dis + '>+ ' + escHtml(e.name) + '</button>';
      }).join('') || '<span class="note">No brands match that name.</span>';
      pick.querySelectorAll('[data-add]').forEach(function (b) {
        b.addEventListener('click', function () {
          var e = bySlug[b.getAttribute('data-add')];
          if (e) { toggle(e.slug, e.name, true); renderPick(); }
        });
      });
    }
    if (q) q.addEventListener('input', renderPick);
    fetch('/compare-index.json').then(function (r) { return r.json(); }).then(function (d) {
      idx = d; d.forEach(function (e) { bySlug[e.slug] = e; });
      var qp = new URLSearchParams(location.search).get('b');
      if (qp) {
        var sel = qp.split(',').map(function (s) { return s.trim(); })
          .filter(function (s) { return bySlug[s]; }).slice(0, MAX)
          .map(function (s) { return { slug: s, name: bySlug[s].name }; });
        if (sel.length) { save(sel); syncBoxes(sel); renderTray(sel); }
      }
      onChange = function (sel) { render(sel); renderPick(); };
      render(load()); renderPick();
    }).catch(function () {
      wrap.innerHTML = '<p class="note">The comparison data could not be loaded. You can still open each brand from the <a href="/brands/">A\u2013Z list</a>.</p>';
    });
  }
})();
