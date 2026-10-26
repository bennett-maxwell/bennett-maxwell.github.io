/* FranchiseKI PerfectFit — productionized matcher (Lane C, 2026-10-26).
 *
 * A faithful client-side port of the prototype of record
 * ($BP/l5-fake-buyers-20261022/matcher.py), which implements
 * matching-engine-design-v1.md section 2 exactly. Frozen weights:
 * Capital 25, Ownership 20, Risk 15, Industry 15, Location 15, Timeline 10.
 * No weight, band table, or default value differs from the prototype.
 *
 * Honesty layer (plan section 3, frozen rubric): a sub-score produced by a
 * neutral default is labelled "defaulted — not stated in the FDD" and never
 * counts toward a brand's "scored on N of 6" coverage. A brand with zero
 * data-backed dimensions is never ranked. The 30%-of-investment liquid
 * capital ESTIMATE is not ingested anywhere in this file and is never
 * scored on. Scores are computed 0-100; brands scoring 0 are excluded
 * from the ranked list (the list therefore presents scores >= 1).
 * "Location" here is territory-terms fit from FDD Item 12 — it is NOT a
 * geographic match and NEVER a claim that any area is available.
 */
(function () {
  'use strict';

  var WEIGHTS = { capital: 25, style: 20, risk: 15, industry: 15, location: 15, timeline: 10 };
  var DIM_LABEL = { capital: 'Capital', style: 'Ownership', risk: 'Risk', industry: 'Industry', location: 'Location (territory terms)', timeline: 'Timeline' };
  var DIM_ORDER = ['capital', 'style', 'risk', 'industry', 'location', 'timeline'];

  /* Python's round() is round-half-to-even; the prototype uses it for the
     capital pro-rata sub-score and for the total. Match it exactly so the
     production totals reproduce the prototype baseline. */
  function pyRound(x) {
    var f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  var RISK_TABLE = {
    '1|conservative': 100, '1|moderate': 60, '1|aggressive': 20,
    '2|conservative': 100, '2|moderate': 70, '2|aggressive': 30,
    '3|conservative': 70, '3|moderate': 100, '3|aggressive': 70,
    '4|conservative': 40, '4|moderate': 70, '4|aggressive': 100,
    '5|conservative': 30, '5|moderate': 60, '5|aggressive': 100
  };

  /* scoreBrand: arithmetic identical to matcher.py score_brand(). Returns
     dims, total, per-dimension coverage status, WHY bullets. */
  function scoreBrand(brand, profile) {
    var dims = {}, cov = {};

    // 1. Capital fit (25)
    var invMin = brand.investmentMin, invMax = brand.investmentMax;
    var budget = profile.investmentBudgetMax;
    var liqReq = brand.liquidCapitalRequired, liq = profile.liquidCapital;
    if (budget == null || invMin == null) dims.capital = 50;
    else if (budget < invMin) dims.capital = 0;
    else if (invMax && budget >= invMax) dims.capital = 100;
    else if (invMax && invMax > invMin) dims.capital = pyRound(100 * (budget - invMin) / (invMax - invMin));
    else dims.capital = 100;
    if (liq != null && liqReq && liq < liqReq) dims.capital = Math.min(dims.capital, 40);
    cov.capital = { scored: invMin != null };

    // 2. Ownership style (20)
    var styles = brand.ownershipStyles || [];
    var want = profile.ownershipStyle;
    if (styles.indexOf(want) !== -1) dims.style = 100;
    else if (styles.length === 1 && styles[0] === 'unspecified') dims.style = 50;
    else dims.style = 20;
    cov.style = { scored: styles.length > 0 };

    // 3. Risk alignment (15)
    var rtier = brand.riskTier;
    var tol = profile.riskTolerance == null ? 3 : profile.riskTolerance;
    var rv = RISK_TABLE[tol + '|' + rtier];
    dims.risk = (rv == null) ? 50 : rv;
    cov.risk = { scored: rtier != null };

    // 4. Industry affinity (15)
    var tags = (brand.industryTags || []).map(function (t) { return String(t).toLowerCase(); });
    var exp = (profile.industryExperience || []).map(function (e) { return String(e).toLowerCase(); });
    var overlap = exp.some(function (e) {
      return tags.indexOf(e) !== -1 || tags.some(function (t) { return t.indexOf(e) !== -1 || e.indexOf(t) !== -1; });
    });
    if (overlap) dims.industry = 100;
    else if (exp.length) dims.industry = 60;
    else dims.industry = 40;
    /* The 40 "no experience" value is a listed neutral default (plan 3.3):
       the dimension counts as scored only when the overlap test actually
       ran against brand data (tags present AND buyer experience present). */
    cov.industry = { scored: tags.length > 0 && exp.length > 0, tagsPresent: tags.length > 0 };

    // 5. Location (15) — territory-terms fit from FDD Item 12, NOT geographic
    var ttype = brand.territoryType, tdesc = brand.territoryDescription;
    if (ttype === 'exclusive' || ttype === 'protected') dims.location = tdesc ? 100 : 80;
    else if (ttype) dims.location = 60;
    else dims.location = 30;
    cov.location = { scored: ttype != null };

    // 6. Timeline (10)
    var btime = brand.timelineMonths, ptime = profile.timelineMonths;
    if (btime && ptime) dims.timeline = (btime <= ptime) ? 100 : 30;
    else dims.timeline = 60;
    cov.timeline = { scored: !!(btime && ptime), brandStated: !!btime };

    var total = 0;
    DIM_ORDER.forEach(function (k) { total += dims[k] * WEIGHTS[k]; });
    var score = pyRound(total / 100);
    var scoredCount = DIM_ORDER.filter(function (k) { return cov[k].scored; }).length;

    return { dims: dims, score: score, cov: cov, scoredCount: scoredCount, why: whyBullets(brand, profile, dims) };
  }

  function money(v) { return '$' + Math.round(v).toLocaleString('en-US'); }

  function whyBullets(brand, profile, dims) {
    var ranked = DIM_ORDER.slice().sort(function (a, b) { return (WEIGHTS[b] * dims[b]) - (WEIGHTS[a] * dims[a]); });
    var out = [];
    ranked.slice(0, 3).forEach(function (k) {
      if (k === 'capital' && brand.investmentMin && brand.investmentMax) {
        out.push('Fits your ' + money(profile.investmentBudgetMax) + ' budget (' + money(brand.investmentMin) + '-' + money(brand.investmentMax) + ' investment)');
      } else if (k === 'style' && dims.style === 100) {
        var s = String(profile.ownershipStyle || '').replace(/-/g, ' ');
        out.push(s.charAt(0).toUpperCase() + s.slice(1) + ' model matches how you want to own');
      } else if (k === 'risk' && brand.riskTier) {
        out.push(brand.riskTier.charAt(0).toUpperCase() + brand.riskTier.slice(1) + ' risk profile' +
          (brand.riskScore != null ? ' (score ' + brand.riskScore + '/100)' : '') + ' suits your tolerance');
      } else if (k === 'industry' && dims.industry === 100) {
        out.push('Matches your industry experience');
      } else if (k === 'location' && (brand.territoryType === 'exclusive' || brand.territoryType === 'protected')) {
        out.push(brand.territoryType.charAt(0).toUpperCase() + brand.territoryType.slice(1) + ' territory terms: the FDD spells out the territory terms (Item 12)');
      } else if (k === 'timeline' && dims.timeline === 100) {
        out.push('Opens inside your ' + profile.timelineMonths + '-month timeline');
      } else {
        out.push({
          capital: 'Investment range is within reach of your budget',
          style: 'Ownership model is flexible on how hands-on you are',
          risk: 'Risk level is a reasonable match for your tolerance',
          industry: 'Open to career changers - no experience penalty',
          location: 'Territory terms are disclosed in its FDD (Item 12)',
          timeline: 'Timeline to open is not yet disclosed'
        }[k]);
      }
    });
    return out;
  }

  /* Missing-dimension reasons, plain language (done-test standard). */
  function missingReason(brand, dim, covEntry, profile) {
    switch (dim) {
      case 'capital': return "this FDD doesn't state a total investment range";
      case 'style': return "this FDD doesn't specify an ownership model";
      case 'risk': return "this FDD's record doesn't include a derived risk tier";
      case 'industry':
        if (!covEntry.tagsPresent) return "this FDD's record doesn't include industry tags";
        return 'add your industry experience above to score this dimension';
      case 'location': return "this FDD doesn't state its territory terms (Item 12)";
      case 'timeline':
        if (!covEntry.brandStated) return "this FDD doesn't state a timeline to open";
        return 'add your timeline to open above to score this dimension';
    }
    return '';
  }

  /* Ownership-style derivation for catalog brands outside the pilot set,
     from the same two FDD operations fields the pilot derivation used.
     Calibrated against the 498 pilot brands: reproduces the pilot's
     ownershipStyles on 497 of 498 (the one exception had no fields in the
     merged view). Data-shaping of extracted FDD fields, not new data. */
  function deriveStyles(ownerOperatorRequired, absenteeOwnershipAllowed) {
    if (ownerOperatorRequired == null && absenteeOwnershipAllowed == null) return [];
    var out = [];
    if (ownerOperatorRequired) out.push('owner-operator');
    if (absenteeOwnershipAllowed) { out.push('semi-absentee'); out.push('absentee'); }
    if (!out.length) out.push('unspecified');
    return out;
  }

  /* Production dataset: the site catalog's own match index (4,131 brands,
     /match-index.json — the data the site build already consumes) merged
     with the prototype/pilot scoring overlay (assets/perfectfit-scoring.json:
     ownershipStyles, riskTier, industryTags, territory description for the
     pilot set, extracted FDD data only). */
  function buildProductionBrands(matchIndex, overlay) {
    var ov = {};
    (overlay.brands || []).forEach(function (b) { ov[b.slug] = b; });
    var seen = {}, out = [];
    (matchIndex || []).forEach(function (mi) {
      var o = ov[mi.slug] || {};
      seen[mi.slug] = true;
      out.push({
        slug: mi.slug,
        name: mi.name || o.name,
        category: mi.category != null ? mi.category : o.category,
        investmentMin: mi.investmentMin != null ? mi.investmentMin : o.investmentMin,
        investmentMax: mi.investmentMax != null ? mi.investmentMax : o.investmentMax,
        liquidCapitalRequired: mi.liquidCapitalRequired != null ? mi.liquidCapitalRequired : o.liquidCapitalRequired,
        netWorthRequired: mi.netWorthRequired != null ? mi.netWorthRequired : o.netWorthRequired,
        ownershipStyles: (o.ownershipStyles && o.ownershipStyles.length) ? o.ownershipStyles : deriveStyles(mi.ownerOperatorRequired, mi.absenteeOwnershipAllowed),
        riskTier: o.riskTier || null,
        riskScore: o.riskScore != null ? o.riskScore : null,
        industryTags: (o.industryTags && o.industryTags.length) ? o.industryTags : (mi.category ? [mi.category] : []),
        territoryType: o.territoryType != null ? o.territoryType : mi.territoryType,
        territoryDescription: o.territoryDescription || null,
        hqState: mi.hqState != null ? mi.hqState : o.hqState,
        timelineMonths: o.timelineMonths != null ? o.timelineMonths : mi.timelineMonths,
        sources: ['site-match-index'].concat(o.sources || [])
      });
    });
    Object.keys(ov).forEach(function (slug) {
      if (!seen[slug]) out.push(ov[slug]);
    });
    return out;
  }

  /* Rank a full brand set for a profile. Scoreable = at least one
     data-backed dimension. Score-0 brands excluded (scores presented >= 1).
     Brands hidden by the buyer's industries-to-avoid filter are counted
     separately, never silently dropped. */
  function rankBrands(brands, profile) {
    var avoid = (profile.industriesAvoid || []).map(function (e) { return String(e).toLowerCase(); });
    var ranked = [], unscored = 0, hiddenAvoid = 0;
    brands.forEach(function (b) {
      var r = scoreBrand(b, profile);
      if (r.scoredCount === 0) { unscored++; return; }
      if (avoid.length) {
        var hay = (b.industryTags || []).map(function (t) { return String(t).toLowerCase(); });
        if (b.category) hay.push(String(b.category).toLowerCase());
        var hit = avoid.some(function (a) { return hay.some(function (t) { return t.indexOf(a) !== -1 || a.indexOf(t) !== -1; }); });
        if (hit) { hiddenAvoid++; return; }
      }
      if (r.score > 0) ranked.push({ brand: b, dims: r.dims, score: r.score, cov: r.cov, scoredCount: r.scoredCount, why: r.why });
    });
    ranked.sort(function (a, b) { return (b.score - a.score) || (a.brand.slug < b.brand.slug ? -1 : 1); });
    return { ranked: ranked, unscored: unscored, hiddenAvoid: hiddenAvoid };
  }

  var api = { WEIGHTS: WEIGHTS, scoreBrand: scoreBrand, whyBullets: whyBullets, missingReason: missingReason, deriveStyles: deriveStyles, buildProductionBrands: buildProductionBrands, rankBrands: rankBrands, pyRound: pyRound };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---------------- Browser UI ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var BRANDS = null, LAST_TOP = null, SHOWN = 25;

  function readProfile() {
    function v(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function checked(name) { return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; }); }
    return {
      investmentBudgetMax: num(v('pf-budget')),
      liquidCapital: num(v('pf-liquid')),
      ownershipStyle: v('pf-style') || null,
      riskTolerance: num(v('pf-risk')) || 3,
      targetState: v('pf-state') || null,
      targetCity: v('pf-city') || null,
      netWorth: num(v('pf-networth')),
      timelineMonths: num(v('pf-timeline')),
      industryExperience: checked('pf-exp'),
      industriesAvoid: checked('pf-avoid'),
      preferredCategory: v('pf-category') || null,
      priorOwnership: v('pf-prior') || null,
      financing: v('pf-financing') || null,
      handsOnHours: v('pf-hours') || null,
      lifestyleGoals: checked('pf-goals'),
      radiusMiles: num(v('pf-radius'))
    };
  }

  function answeredCount(p) {
    var n = 0;
    if (p.investmentBudgetMax != null) n++;
    if (p.liquidCapital != null) n++;
    if (p.ownershipStyle) n++;
    if (p.targetState) n++;
    n++; // risk tolerance always has a value (slider)
    if (p.targetCity) n++;
    if (p.netWorth != null) n++;
    if (p.timelineMonths != null) n++;
    if (p.industryExperience.length) n++;
    if (p.industriesAvoid.length) n++;
    if (p.preferredCategory) n++;
    if (p.priorOwnership) n++;
    if (p.financing) n++;
    if (p.handsOnHours) n++;
    if (p.lifestyleGoals.length) n++;
    if (p.radiusMiles != null) n++;
    return n;
  }

  function coverageLine(r) {
    var base;
    if (r.scoredCount === 6) {
      base = 'Scored on 6 of 6 dimensions from FDD-stated data.';
    } else {
      var reasons = [];
      DIM_ORDER.forEach(function (k) {
        if (!r.cov[k].scored) {
          var why = missingReason(r.brand, k, r.cov[k], readProfile());
          if (why) reasons.push(DIM_LABEL[k] + ': ' + why);
        }
      });
      base = 'Scored on ' + r.scoredCount + ' of 6 dimensions — ' + reasons.join(' · ');
    }
    /* The two capital-requirement fields are named even when Capital itself
       scored on the investment range (the done-test's example sentence). */
    var extra = [];
    if (r.brand.liquidCapitalRequired == null) extra.push("this FDD doesn't state a liquid-capital requirement");
    if (r.brand.netWorthRequired == null) extra.push("this FDD doesn't state a net-worth requirement");
    if (extra.length) base += ' Capital note: ' + extra.join('; ') + '.';
    return base;
  }

  function render() {
    if (!BRANDS) return;
    var p = readProfile();
    var ready = p.investmentBudgetMax != null && p.liquidCapital != null && p.ownershipStyle && p.targetState;
    var note = document.getElementById('pf-change');
    var box = document.getElementById('pf-results');
    document.getElementById('pf-strength').textContent =
      'Profile completeness: ' + answeredCount(p) + ' of 16 answers. The 5 required answers produce your ranking; every optional answer you add re-scores the list live.';
    if (!ready) {
      box.innerHTML = '<p class="note">Answer the 5 required questions (marked *) and your ranked PerfectFit list appears here instantly — no submit button, nothing is sent anywhere.</p>';
      note.textContent = '';
      LAST_TOP = null;
      return;
    }
    var res = rankBrands(BRANDS, p);
    var top = res.ranked.slice(0, 20).map(function (r) { return r.brand.slug + ':' + r.score; }).join(',');
    if (LAST_TOP != null && LAST_TOP !== top) {
      var prev = LAST_TOP.split(',');
      var moved = 0, fresh = 0;
      res.ranked.slice(0, 20).forEach(function (r, i) {
        var key = r.brand.slug + ':' + r.score;
        if (prev.indexOf(key) === -1) { if (prev.some(function (x) { return x.split(':')[0] === r.brand.slug; })) moved++; else fresh++; }
      });
      note.textContent = 'What changed: your top 20 re-ranked — ' + moved + ' brands changed score, ' + fresh + ' new entrant(s). ' +
        (p.timelineMonths != null || p.industryExperience.length ? 'Timeline and industry dimensions are now scored on your answers where a brand\'s FDD states the data.' : '');
    } else if (LAST_TOP != null) {
      note.textContent = 'What changed: that answer did not move your top 20 (it may still matter further down the list, or no brand\'s FDD states the data it would score against — FranchiseKI never estimates a missing value).';
    }
    LAST_TOP = top;

    var html = '<p class="small">' + res.ranked.length + ' brands ranked for your profile. ' +
      res.unscored + ' catalog brands carry no scoring data in any dimension and are not ranked — they are never given a made-up score.' +
      (res.hiddenAvoid ? ' ' + res.hiddenAvoid + ' brand(s) hidden by your industries-to-avoid picks.' : '') +
      ' Location below means territory terms stated in the FDD (Item 12) — not distance from you, and never a claim that an area is available.</p>';
    res.ranked.slice(0, SHOWN).forEach(function (r, i) {
      var b = r.brand;
      html += '<article class="fitcard"><div class="fitbar"><b>#' + (i + 1) + ' <a href="/brands/' + esc(b.slug) + '/">' + esc(b.name || b.slug) + '</a></b>' +
        '<span class="pill">PerfectFit ' + r.score + ' / 100</span></div>' +
        '<p class="small">' + esc(b.category || '') +
        (b.investmentMin != null ? ' · Investment ' + money(b.investmentMin) + (b.investmentMax != null ? '–' + money(b.investmentMax) : '') : '') +
        (b.territoryType ? ' · Territory terms (Item 12): ' + esc(b.territoryType) : '') +
        (p.preferredCategory && b.category === p.preferredCategory ? ' · <b>Your preferred category</b>' : '') + '</p>' +
        '<p class="small"><b>' + esc(coverageLine(r)) + '</b></p><ul class="dimlist">';
      DIM_ORDER.forEach(function (k) {
        var c = r.cov[k];
        var tag = c.scored ? 'FDD data' : (k === 'capital' && b.investmentMin != null ? 'FDD data (range)' : 'defaulted — not stated in the FDD');
        if (!c.scored && (k === 'industry' && c.tagsPresent)) tag = 'not scored — add your experience';
        if (!c.scored && k === 'timeline' && c.brandStated) tag = 'not scored — add your timeline';
        html += '<li>' + DIM_LABEL[k] + ' (' + WEIGHTS[k] + '): <b>' + r.dims[k] + '</b> <span class="chip">' + tag + '</span></li>';
      });
      html += '</ul><ul>';
      r.why.forEach(function (w) { html += '<li>' + esc(w) + '</li>'; });
      html += '</ul></article>';
    });
    if (res.ranked.length > SHOWN) html += '<button type="button" id="pf-more" class="pill">Show more brands</button>';
    box.innerHTML = html;
    var more = document.getElementById('pf-more');
    if (more) more.addEventListener('click', function () { SHOWN += 25; render(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('pf-root')) return;
    var risk = document.getElementById('pf-risk');
    var riskOut = document.getElementById('pf-risk-out');
    if (risk && riskOut) risk.addEventListener('input', function () { riskOut.textContent = risk.value; });
    Promise.all([
      fetch('../match-index.json').then(function (r) { return r.json(); }),
      fetch('../assets/perfectfit-scoring.json').then(function (r) { return r.json(); }),
      fetch('../assets/perfectfit-buyers.json').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (parts) {
      BRANDS = buildProductionBrands(parts[0], parts[1]);
      var catSel = document.getElementById('pf-category');
      var cats = {};
      BRANDS.forEach(function (b) { if (b.category) cats[b.category] = true; });
      Object.keys(cats).sort().forEach(function (c) {
        var opt = document.createElement('option'); opt.value = c; opt.textContent = c; catSel.appendChild(opt);
      });
      var sb = document.getElementById('pf-sample');
      if (sb && parts[2] && parts[2].buyers) {
        parts[2].buyers.forEach(function (buyer) {
          var opt = document.createElement('option');
          opt.value = buyer.id;
          opt.textContent = buyer.id + ' — SYNTHETIC TEST PROFILE (not a real person)';
          sb.appendChild(opt);
        });
        sb.addEventListener('change', function () {
          var buyer = parts[2].buyers.filter(function (x) { return x.id === sb.value; })[0];
          if (!buyer) return;
          function set(id, val) { var el = document.getElementById(id); if (el && val != null) el.value = val; }
          set('pf-budget', buyer.investmentBudgetMax);
          set('pf-liquid', buyer.liquidCapital);
          set('pf-style', buyer.ownershipStyle);
          set('pf-risk', buyer.riskTolerance);
          if (riskOut) riskOut.textContent = buyer.riskTolerance;
          set('pf-state', buyer.location && buyer.location.state);
          set('pf-city', buyer.location && buyer.location.city);
          set('pf-networth', buyer.netWorth);
          set('pf-timeline', buyer.timelineMonths);
          set('pf-radius', buyer.location && buyer.location.radiusMiles);
          document.querySelectorAll('input[name="pf-exp"]').forEach(function (i) { i.checked = (buyer.industryExperience || []).indexOf(i.value) !== -1; });
          document.querySelectorAll('input[name="pf-goals"]').forEach(function (i) { i.checked = (buyer.lifestyleGoals || []).indexOf(i.value) !== -1; });
          LAST_TOP = null;
          render();
        });
      }
      document.getElementById('pf-form').addEventListener('input', function () { SHOWN = 25; render(); });
      render();
    }).catch(function (e) {
      document.getElementById('pf-results').innerHTML = '<p class="note">The matching data could not be loaded (' + esc(e.message) + '). Please reload the page.</p>';
    });
  });
})();
