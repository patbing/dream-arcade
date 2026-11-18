/* Dream Arcade: runs a generated game in a sandboxed iframe, with or without the bot.
 * The game is untrusted code: it gets srcdoc + sandbox="allow-scripts" (an opaque origin, so no access to this page,
 * its storage or the visitor's key) and a CSP that blocks all network. Results come back by postMessage as plain numbers. */
(function (root) {
  'use strict';

  var CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";

  // Runs inside the game frame before the game. With a plan it fakes the clock (60 s of play in about a second) and
  // presses keys; without one it only reports errors so the visitor can play normally.
  function prelude(cfg) {
    var errors = [], token = cfg.token;
    function report(msg) { var m = String(msg || 'error').slice(0, 160); if (errors.length < 20) errors.push(m); }
    window.addEventListener('error', function (e) { report(e.message); });
    window.addEventListener('unhandledrejection', function (e) { report('unhandled promise: ' + (e.reason && e.reason.message || e.reason)); });
    if (!cfg.plan) {
      setTimeout(function () { parent.postMessage({ token: token, errors: errors, ready: true }, '*'); }, 1500);
      return;
    }
    // A fixed window size: a hidden or offscreen frame reports 0x0, and the same seed must draw the same frames anywhere.
    // shortcut: games that size from element.clientWidth still see 0 when hidden; fix if a real game does that.
    [['innerWidth', 640], ['innerHeight', 360], ['devicePixelRatio', 1]].forEach(function (p) {
      try { Object.defineProperty(window, p[0], { get: function () { return p[1]; }, configurable: true }); } catch (e) {}
    });
    var seed = cfg.seed >>> 0;
    Math.random = function () { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    var now = 0, nextId = 1, timers = [], frames = [], BASE = 1767225600000;
    function guard(fn, args) { try { fn.apply(window, args || []); } catch (e) { report(e && e.message || e); } }
    window.requestAnimationFrame = function (cb) { var id = nextId++; frames.push({ id: id, cb: cb }); return id; };
    window.cancelAnimationFrame = function (id) { frames = frames.filter(function (f) { return f.id !== id; }); };
    window.setTimeout = function (cb, ms) { var id = nextId++; if (typeof cb === 'function') timers.push({ id: id, at: now + Math.max(0, +ms || 0), cb: cb, args: [].slice.call(arguments, 2) }); return id; };
    window.setInterval = function (cb, ms) { var id = nextId++, every = Math.max(4, +ms || 0); if (typeof cb === 'function') timers.push({ id: id, at: now + every, every: every, cb: cb, args: [].slice.call(arguments, 2) }); return id; };
    window.clearTimeout = window.clearInterval = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };
    performance.now = function () { return now; };
    Date.now = function () { return BASE + now; };
    function tick(to) {
      var due = timers.filter(function (t) { return t.at <= to; }).sort(function (a, b) { return a.at - b.at; });
      due.forEach(function (t) {
        if (timers.indexOf(t) < 0) return;
        if (t.every) t.at += t.every * Math.max(1, Math.ceil((to - t.at + 1) / t.every)); else timers.splice(timers.indexOf(t), 1);
        guard(t.cb, t.args);
      });
      now = to;
      var fs = frames; frames = [];
      fs.forEach(function (f) { guard(f.cb, [now]); });
    }
    var small = document.createElement('canvas'); small.width = 32; small.height = 18;
    var sg = small.getContext('2d', { willReadFrequently: true });
    function bigCanvas() {
      var best = null, area = 0;
      [].forEach.call(document.querySelectorAll('canvas'), function (c) { var a = c.width * c.height; if (a > area) { area = a; best = c; } });
      return best;
    }
    function sig() {
      var c = bigCanvas(); if (!c || !c.width || !c.height) return null;
      try {
        sg.clearRect(0, 0, 32, 18); sg.drawImage(c, 0, 0, 32, 18);
        var d = sg.getImageData(0, 0, 32, 18).data, out = [];
        for (var i = 0; i < d.length; i += 4) out.push(Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]));
        return out;
      } catch (e) { report('canvas unreadable: ' + e.message); return null; }
    }
    function state() {
      try {
        var p = window.__play, s = p && typeof p.state === 'function' ? p.state() : null;
        if (!s || typeof s !== 'object') return null;
        var o = {}; ['score', 'lives', 'level'].forEach(function (k) { if (typeof s[k] === 'number' && isFinite(s[k])) o[k] = s[k]; });
        ['over', 'won'].forEach(function (k) { if (typeof s[k] === 'boolean') o[k] = s[k]; });
        return o;
      } catch (e) { report('state(): ' + e.message); return null; }
    }
    function press(type, key, code) {
      var opts = { key: key, code: code, bubbles: true, cancelable: true };
      var ev = new KeyboardEvent(type, opts), target = document.activeElement || document.body || document.documentElement;
      guard(function () { target.dispatchEvent(ev); });
    }
    function run() {
      var plan = cfg.plan, ev = plan.events.slice(), samples = [], step = 1000 / 60, t = 0, nextSample = 0;
      guard(function () { window.dispatchEvent(new Event('resize')); });
      while (t <= plan.ms) {
        while (ev.length && ev[0].t <= t) { var e = ev.shift(); press(e.type === 'down' ? 'keydown' : 'keyup', e.key, e.code); }
        if (t >= nextSample) { samples.push({ t: nextSample, sig: sig(), state: state() }); nextSample += nextSample < cfg.fineUntil ? cfg.fineMs : cfg.sampleMs; } // fine samples while a key is held: a punch can last 0.2 s
        t += step; tick(t);
      }
      var p = window.__play, ctrl = null;
      try { ctrl = p && Array.isArray(p.controls) ? p.controls.map(function (c) { return { key: String(c && c.key || ''), does: String(c && c.does || '') }; }) : null; } catch (e) { report('controls: ' + e.message); }
      parent.postMessage({ token: token, errors: errors, samples: samples, canvas: !!bigCanvas(), controls: ctrl }, '*');
    }
    window.addEventListener('load', function () { setTimeoutReal(run, 0); });
    var setTimeoutReal = window.__realSetTimeout;
  }

  function srcdoc(gameHtml, cfg) {
    var head = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
      '<script>window.__realSetTimeout = setTimeout.bind(window);(' + prelude.toString() + ')(' + JSON.stringify(cfg) + ');<\/script>';
    var html = String(gameHtml || '');
    // The prelude must run before any game script: put it right after <head>, or first if there is none.
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + head; });
    return '<!doctype html><html><head>' + head + '</head><body>' + html + '</body></html>';
  }

  // Runs one plan; resolves to the frame's report or { loadError }.
  function runPlan(gameHtml, plan, seed, timeoutMs) {
    return new Promise(function (resolve) {
      var token = Math.random().toString(36).slice(2), f = document.createElement('iframe'), done = false;
      var events = plan.events.map(function (e) { return { t: e.t, type: e.type, key: e.key, code: root.DA.judge.code(e.key) }; });
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-2000px;top:0;width:640px;height:360px;border:0;';
      function finish(r) { if (done) return; done = true; window.removeEventListener('message', onMsg); clearTimeout(timer); f.remove(); resolve(r); }
      function onMsg(e) {
        if (e.source !== f.contentWindow || !e.data || e.data.token !== token) return;
        finish(clean(e.data));
      }
      var timer = setTimeout(function () { finish({ loadError: 'the game did not finish ' + plan.name + ' within ' + Math.round((timeoutMs || 20000) / 1000) + ' s (stuck in a loop?)', errors: [] }); }, timeoutMs || 20000);
      window.addEventListener('message', onMsg);
      f.srcdoc = srcdoc(gameHtml, { token: token, seed: seed, sampleMs: root.DA.judge.SAMPLE_MS, fineMs: root.DA.judge.FINE_MS, fineUntil: root.DA.judge.KEY_AT + root.DA.judge.KEY_HOLD + 500, plan: { ms: plan.ms, events: events } });
      document.body.appendChild(f);
    });
  }

  // Only numbers and short strings cross back from the game frame.
  function clean(d) {
    var out = { errors: (Array.isArray(d.errors) ? d.errors : []).slice(0, 20).map(function (x) { return String(x).slice(0, 160); }), canvas: d.canvas === true, samples: [] };
    (Array.isArray(d.samples) ? d.samples : []).slice(0, 600).forEach(function (s) {
      var sig = Array.isArray(s.sig) && s.sig.length === 576 ? s.sig.map(function (v) { return Math.max(0, Math.min(255, +v || 0)); }) : null;
      var st = null;
      if (s.state && typeof s.state === 'object') { st = {}; ['score', 'lives', 'level'].forEach(function (k) { if (typeof s.state[k] === 'number' && isFinite(s.state[k])) st[k] = s.state[k]; }); ['over', 'won'].forEach(function (k) { if (typeof s.state[k] === 'boolean') st[k] = s.state[k]; }); }
      out.samples.push({ t: +s.t || 0, sig: sig, state: st });
    });
    out.controls = Array.isArray(d.controls) ? d.controls.slice(0, 12).map(function (c) { return { key: String(c.key).slice(0, 20), does: String(c.does).slice(0, 80) }; }) : null;
    return out;
  }

  // Full playtest: a first idle run also reads the declared controls, then one run per key and a monkey run.
  function playtest(gameHtml, seed, onProgress) {
    var J = root.DA.judge, results = {};
    var idlePlan = J.plans([])[0];
    return runPlan(gameHtml, idlePlan, seed).then(function (idle) {
      results.idle = idle;
      var ctrl = J.controls(idle.controls || []);
      var rest = J.plans(ctrl.list, mulberry(seed)).slice(1), i = 0;
      function next() {
        if (i >= rest.length) return Promise.resolve();
        var p = rest[i++]; if (onProgress) onProgress(i, rest.length);
        return runPlan(gameHtml, p, seed).then(function (r) { results[p.name] = r; return next(); });
      }
      return next().then(function () { return { controls: ctrl, results: results, verdict: J.verdict(ctrl.list, results) }; });
    });
  }
  function mulberry(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  root.DA = root.DA || {};
  root.DA.harness = { CSP: CSP, srcdoc: srcdoc, runPlan: runPlan, playtest: playtest };
})(window);
