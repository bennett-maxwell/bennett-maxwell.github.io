/* FranchiseKI PerfectFit: profile + honest client-side scoring. */
(function () {
  var KEY = 'fki-profile';
  var AVAIL_LABEL = "Most likely available \u2014 no existing or announced outlets here, based on the brand's latest FDD (Item 20). Only the franchisor can confirm availability.";
  var WEIGHTS = { capital: 25, ownership: 20, risk: 15, industry: 15, location: 15, timeline: 10 };
  var DIM_LABEL = { capital: 'Capital', ownership: 'Ownership', risk: 'Risk', industry: 'Industry', location: 'Location', timeline: 'Timeline' };

  function loadProfile() { try { var v = JSON.parse(localStorage.getItem(KEY)); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; } }
  function saveProfile(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) { return (v == null) ? null : '$' + Math.round(v).toLocaleString('en-US'); }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  /* ---- Capital (25). Scored when the brand discloses investmentMin and the
     buyer gave at least one capital number. Full marks when the buyer's max
     investment covers investmentMax and liquid capital covers investmentMin;
     proportional below that; 0 when the buyer's max is under investmentMin.
     Method: capital fit compares your numbers with the brand's Item 7 total
     investment range in its FDD. Where the brand also discloses a liquid
     capital (or net worth) requirement, that disclosed figure is checked
     directly and the check is named in the breakdown note. ---- */
  function scoreCapital(p, b) {
    if (b.investmentMin == null) return null;
    if (p.maxInvestment == null && p.liquidCapital == null && !(b.netWorthRequired != null && p.netWorth != null)) return null;
    var parts = [], notes = [];
    if (p.maxInvestment != null) {
      var s;
      if (p.maxInvestment < b.investmentMin) s = 0;
      else if (b.investmentMax == null || b.investmentMax <= b.investmentMin) s = 1;
      else if (p.maxInvestment >= b.investmentMax) s = 1;
      else s = (p.maxInvestment - b.investmentMin) / (b.investmentMax - b.investmentMin);
      parts.push(s);
    }
    if (b.liquidCapitalRequired != null && p.liquidCapital != null) {
      parts.push(p.liquidCapital >= b.liquidCapitalRequired ? 1 : p.liquidCapital / b.liquidCapitalRequired);
      notes.push('This brand discloses a liquid capital requirement of ' + money(b.liquidCapitalRequired) + ' in its FDD \u2014 checked against yours.');
    } else if (p.liquidCapital != null) {
      parts.push(p.liquidCapital >= b.investmentMin ? 1 : p.liquidCapital / b.investmentMin);
    }
    if (b.netWorthRequired != null && p.netWorth != null) {
      parts.push(p.netWorth >= b.netWorthRequired ? 1 : p.netWorth / b.netWorthRequired);
      notes.push('This brand discloses a net worth requirement of ' + money(b.netWorthRequired) + ' in its FDD \u2014 checked against yours.');
    }
    if (!parts.length) return null;
    var avg = parts.reduce(function (a, x) { return a + x; }, 0) / parts.length;
    return { score: clamp(avg), note: notes.join(' ') || null };
  }

  /* ---- Ownership (20). Scored when the buyer picked a style AND the brand
     discloses ownerOperatorRequired or absenteeOwnershipAllowed.
     Match = 1, flexible-but-not-ideal = 0.5, direct conflict = 0:
       owner-operator buyer: full when the brand requires or expects hands-on
         operation (ownerOperatorRequired, or absentee not allowed); partial
         when the brand allows absentee owners too (you may still operate).
       semi-absentee buyer: full when absentee ownership is allowed and the
         brand does not require owner-operation; conflict when the brand
         requires the owner to operate.
       absentee buyer: full when absentee ownership is allowed; conflict when
         the brand requires the owner to operate it personally. ---- */
  function scoreOwnership(p, b) {
    if (!p.ownership || p.ownership === 'none') return null;
    if (b.ownerOperatorRequired == null && b.absenteeOwnershipAllowed == null) return null;
    var oor = b.ownerOperatorRequired, aoa = b.absenteeOwnershipAllowed;
    if (p.ownership === 'owner-operator') {
      if (oor === true || aoa === false) return { score: 1 };
      return { score: 0.5 };
    }
    if (p.ownership === 'semi-absentee') {
      if (oor === true) return { score: 0 };
      if (aoa === true) return { score: 1 };
      return { score: 0.5 };
    }
    if (p.ownership === 'absentee') {
      if (aoa === true) return { score: 1 };
      if (oor === true) return { score: 0 };
      return { score: 0.5 };
    }
    return null;
  }

  /* ---- Risk (15). Scored when the brand discloses ANY risk signal
     (closures3yr / bankruptcyFlag / litigationCount / unitsHistory).
     A disclosed bankruptcy scores 0 outright. Otherwise a signal level
     s in [0,1] (higher = riskier) is built transparently:
       base from 3-year closures as a share of franchised units
         (<=2% -> 0.10, <=5% -> 0.35, <=10% -> 0.60, above -> 0.85;
          absolute closures >=10 with no unit base -> 0.60);
       +0.15 for 1-2 disclosed litigation matters, +0.30 for 3+;
       +0.20 if the unit trend is shrinking, -0.10 if growing.
     With no closure base, litigation/trend alone set the level.
     The buyer's comfort sets a tolerance (conservative 0.25, moderate 0.50,
     aggressive 0.80): at or under tolerance = full marks, scaling to 0 as
     the signal approaches 1. ---- */
  function scoreRisk(p, b) {
    if (!p.risk) return null;
    var has = (b.closures3yr != null) || (b.bankruptcyFlag != null) ||
              (b.litigationCount != null) || (b.unitsTrend != null);
    if (!has) return null;
    if (b.bankruptcyFlag === true) return { score: 0, note: 'This brand discloses a bankruptcy in Item 4 of its FDD.' };
    var s = null;
    if (b.closures3yr != null) {
      if (b.franchisedUnits) {
        var rate = b.closures3yr / b.franchisedUnits;
        s = rate <= 0.02 ? 0.10 : rate <= 0.05 ? 0.35 : rate <= 0.10 ? 0.60 : 0.85;
      } else {
        s = b.closures3yr >= 10 ? 0.60 : b.closures3yr > 0 ? 0.35 : 0.10;
      }
    }
    if (b.litigationCount != null) {
      var lit = b.litigationCount >= 3 ? 0.30 : b.litigationCount >= 1 ? 0.15 : 0;
      s = (s == null) ? 0.20 + lit : s + lit;
    }
    if (b.unitsTrend === 'shrinking') s = (s == null ? 0.45 : s + 0.20);
    if (b.unitsTrend === 'growing') s = (s == null ? 0.10 : s - 0.10);
    if (s == null) s = 0.30;
    s = clamp(s);
    var tol = p.risk === 'conservative' ? 0.25 : p.risk === 'aggressive' ? 0.80 : 0.50;
    var score = s <= tol ? 1 : clamp(1 - (s - tol) / (1 - tol));
    return { score: score };
  }

  /* ---- Industry (15): brand category among the buyer's picks = full. ---- */
  function scoreIndustry(p, b) {
    if (!p.categories || !p.categories.length) return null;
    return { score: (b.category && p.categories.indexOf(b.category) >= 0) ? 1 : 0 };
  }

  /* ---- Location (15). Scored when the buyer gave a target state AND the
     brand has Item 20 data. Outlets in the target state prove presence
     (0.70) \u2014 territory status is still governed by the brand's Item 12
     type. An exclusive/protected brand with NO outlets in the target state
     scores highest (1.0) and its card carries AVAIL_LABEL verbatim.
     Non-exclusive or no-territory brands with no outlets there: 0.50. ---- */
  function scoreLocation(p, b) {
    if (!p.targetState || !b.hasItem20) return null;
    if (b.item20States && b.item20States.indexOf(p.targetState) >= 0) {
      return { score: 0.70, note: 'This brand already operates in ' + p.targetState + ' (Item 20) \u2014 presence is proven; whether a new unit can be placed near an existing one is governed by its Item 12 territory rule.' };
    }
    if (b.territoryType === 'exclusive' || b.territoryType === 'protected') {
      return { score: 1.0, avail: true, note: AVAIL_LABEL };
    }
    return { score: 0.50, note: 'This brand discloses no outlets in ' + p.targetState + ' in its latest FDD (Item 20), and its Item 12 rule grants no exclusivity, so there are no territory-based exclusions.' };
  }

  /* ---- Timeline (10): full when the brand's typical time-to-open is at or
     under the buyer's desired timeline; loses ~1/12 per month over. ---- */
  function scoreTimeline(p, b) {
    if (p.timeline == null || b.timelineMonths == null) return null;
    if (b.timelineMonths <= p.timeline) return { score: 1 };
    return { score: clamp(1 - (b.timelineMonths - p.timeline) / 12) };
  }

  var SCORERS = { capital: scoreCapital, ownership: scoreOwnership, risk: scoreRisk, industry: scoreIndustry, location: scoreLocation, timeline: scoreTimeline };

  function scoreBrand(p, b) {
    var dims = {}, wsum = 0, ssum = 0, n = 0;
    Object.keys(WEIGHTS).forEach(function (k) {
      var r = SCORERS[k](p, b);
      dims[k] = r;
      if (r) { wsum += WEIGHTS[k]; ssum += WEIGHTS[k] * r.score; n += 1; }
    });
    return { dims: dims, scored: n, fit: n ? Math.round(100 * ssum / wsum) : null };
  }

  /* Exported for the node smoke harness; harmless in the browser. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scoreBrand: scoreBrand, SCORERS: SCORERS, WEIGHTS: WEIGHTS };
  }

  /* ---------------- homepage matcher strip ---------------- */
  var mForm = document.getElementById('matcher-form');
  if (mForm) {
    mForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var p = loadProfile();
      var st = document.getElementById('m-state'), lc = document.getElementById('m-liquid');
      if (st && st.value) p.targetState = st.value;
      var lv = num(lc && lc.value);
      if (lv != null) p.liquidCapital = lv;
      saveProfile(p);
      location.href = '/quiz/';
    });
  }

  /* ---------------- /quiz/ page ---------------- */
  var form = document.getElementById('quiz-form');
  var results = document.getElementById('quiz-results');
  if (!form || !results) return;
  var idx = null;

  function fillForm(p) {
    var set = function (id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('q-liquid', p.liquidCapital); set('q-networth', p.netWorth);
    set('q-maxinv', p.maxInvestment); set('q-state', p.targetState); set('q-timeline', p.timeline);
    if (p.ownership) { var r = form.querySelector('input[name="q-own"][value="' + p.ownership + '"]'); if (r) r.checked = true; }
    if (p.risk) { var r2 = form.querySelector('input[name="q-risk"][value="' + p.risk + '"]'); if (r2) r2.checked = true; }
    (p.categories || []).forEach(function (c) {
      var cb = form.querySelector('input[name="q-cat"][value="' + c.replace(/"/g, '') + '"]');
      if (cb) cb.checked = true;
    });
  }
  function readForm() {
    var p = {};
    p.liquidCapital = num(document.getElementById('q-liquid').value);
    p.netWorth = num(document.getElementById('q-networth').value);
    p.maxInvestment = num(document.getElementById('q-maxinv').value);
    p.targetState = document.getElementById('q-state').value || null;
    p.timeline = num(document.getElementById('q-timeline').value);
    var own = form.querySelector('input[name="q-own"]:checked');
    p.ownership = own ? own.value : null;
    var rk = form.querySelector('input[name="q-risk"]:checked');
    p.risk = rk ? rk.value : null;
    p.categories = Array.prototype.map.call(form.querySelectorAll('input[name="q-cat"]:checked'), function (c) { return c.value; });
    Object.keys(p).forEach(function (k) { if (p[k] === null) delete p[k]; });
    return p;
  }
  function render(p) {
    if (!idx) return;
    var scored = [], unscored = [];
    idx.forEach(function (b) {
      var r = scoreBrand(p, b);
      if (r.scored >= 3) scored.push({ b: b, r: r });
      else unscored.push(b);
    });
    scored.sort(function (a, z) { return z.r.fit - a.r.fit || a.b.name.localeCompare(z.b.name); });
    var h = '<h2>Your matches \u2014 ' + scored.length.toLocaleString('en-US') + ' brands scored</h2>';
    h += '<p class="note">Ranked by Fit Score. A dimension that the brand\u2019s FDD does not disclose is excluded from that brand\u2019s score and labeled below \u2014 nothing is estimated. Capital fit compares your numbers with the brand\u2019s Item 7 total investment range in its FDD.</p>';
    scored.slice(0, 60).forEach(function (x) {
      var b = x.b, r = x.r;
      h += '<div class="fitcard"><h3><a href="/brands/' + b.slug + '/">' + escHtml(b.name) + '</a></h3>';
      h += '<div>Fit Score <b>' + r.fit + '</b> \u2014 scored on ' + r.scored + ' of 6 dimensions</div>';
      h += '<div class="fitbar"><i style="width:' + r.fit + '%"></i></div>';
      var meta = [];
      if (b.category) meta.push(escHtml(b.category));
      if (b.investmentMin != null) meta.push('Investment ' + money(b.investmentMin) + (b.investmentMax != null ? ' \u2013 ' + money(b.investmentMax) : ''));
      if (b.franchiseFee != null) meta.push('Fee ' + money(b.franchiseFee));
      if (meta.length) h += '<div class="figs">' + meta.join(' \u00B7 ') + '</div>';
      h += '<ul class="dimlist">';
      Object.keys(WEIGHTS).forEach(function (k) {
        var d = r.dims[k];
        if (d) {
          h += '<li>' + DIM_LABEL[k] + ': ' + Math.round(100 * d.score) + '%' + (d.note ? ' \u2014 ' + escHtml(d.note) : '') + '</li>';
        } else {
          h += '<li>' + DIM_LABEL[k] + ': not scored \u2014 the FDD data we hold does not disclose what this dimension needs (or you left it blank).</li>';
        }
      });
      h += '</ul>';
      h += '<label class="cmp"><input type="checkbox" class="cmp-add" data-slug="' + b.slug + '" data-name="' + escHtml(b.name) + '"> Compare</label> ';
      h += '<a href="/compare/">Open the comparison \u2192</a></div>';
    });
    if (scored.length > 60) h += '<p class="note">Showing the top 60 of ' + scored.length.toLocaleString('en-US') + ' scored brands. Narrow your answers (target state, categories) to sharpen the list.</p>';
    h += '<h2>Not enough FDD data to score</h2><p class="note">' + unscored.length.toLocaleString('en-US') + ' brands are scored on fewer than 3 dimensions, so no Fit Score is shown for them: <b>Not enough FDD data to score this brand.</b> They are still in the catalog \u2014 browse them in the <a href="/brands/">A\u2013Z list</a>.</p>';
    results.innerHTML = h;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var p = readForm();
    saveProfile(p);
    render(p);
    results.scrollIntoView();
  });
  fetch('/match-index.json').then(function (r) { return r.json(); }).then(function (d) {
    idx = d;
    var p = loadProfile();
    if (Object.keys(p).length) { fillForm(p); render(p); }
  }).catch(function () {
    results.innerHTML = '<p class="note">The matching data could not be loaded. You can still browse the full catalog in the <a href="/brands/">A\u2013Z list</a>.</p>';
  });
})();
