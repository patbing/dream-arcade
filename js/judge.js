/* Dream Arcade: the playtest judge. Pure functions, no DOM, no network. Browser (window.DA.judge) and node (require).
 * The bot plays every game with the same seed and a fake clock, so two runs differ only by the keys pressed.
 * Verdicts come from screen samples (a 32x18 brightness grid of the canvas) and errors, not from what the game says about itself. */
(function (root) {
  'use strict';

  var SAMPLE_MS = 250, FINE_MS = 50, IDLE_MS = 60000, KEY_AT = 1000, KEY_HOLD = 1500, MONKEY_MS = 30000;
  // Same seed and fake clock: with no key pressed two runs draw identical frames, so any cell that differs was changed
  // by the key. DIFF is the largest per-cell brightness change (0-255) that still counts as rounding noise, plus one.
  var DIFF = 3;

  // Key names the bot can press, as KeyboardEvent key and code.
  var CODES = { ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ' ': 'Space', Enter: 'Enter', Shift: 'ShiftLeft', Escape: 'Escape' };
  function code(key) {
    if (CODES[key]) return CODES[key];
    if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
    if (/^[0-9]$/.test(key)) return 'Digit' + key;
    return null;
  }

  // The controls a game declares: [{ key, does }]. Unknown keys are dropped and counted.
  function controls(list) {
    var out = [], seen = {}, dropped = 0;
    (Array.isArray(list) ? list : []).forEach(function (c) {
      var k = c && typeof c.key === 'string' ? (c.key === 'Space' || c.key === 'Spacebar' ? ' ' : c.key) : null;
      if (k && k.length === 1) k = k === ' ' ? ' ' : k.toLowerCase();
      if (!k || !code(k) || seen[k] || out.length >= 8) { dropped++; return; }
      seen[k] = 1;
      var does = String((c && c.does) || '').slice(0, 80);
      // A restart key does nothing until game over, so the bot does not hold it.
      out.push({ key: k, does: does, restart: /restart|play again|new game|start over|reset/i.test(does) || undefined });
    });
    return { list: out, dropped: dropped };
  }

  // Run plans. Each run is a fresh page with the same seed: { name, ms, events: [{ t, type: 'down'|'up', key }] }.
  function plans(ctrl, rand) {
    var runs = [{ name: 'idle', ms: IDLE_MS, events: [] }];
    ctrl.forEach(function (c) {
      if (c.restart) return;
      runs.push({ name: 'key:' + c.key, key: c.key, ms: KEY_AT + KEY_HOLD + 500, events: [{ t: KEY_AT, type: 'down', key: c.key }, { t: KEY_AT + KEY_HOLD, type: 'up', key: c.key }] });
    });
    if (ctrl.length) { // a monkey: random holds of the declared keys, reproducible from rand
      var ev = [], t = 500, r = rand || Math.random;
      while (t < MONKEY_MS - 600) {
        var play = ctrl.filter(function (c) { return !c.restart; }); if (!play.length) play = ctrl;
        var k = play[Math.floor(r() * play.length)].key, hold = 100 + Math.floor(r() * 500);
        ev.push({ t: t, type: 'down', key: k }, { t: t + hold, type: 'up', key: k });
        t += hold + 50 + Math.floor(r() * 300);
      }
      runs.push({ name: 'monkey', ms: MONKEY_MS, events: ev });
    }
    return runs;
  }

  function diff(a, b) { // the largest change in any one cell of the 32x18 brightness grid
    if (!a || !b || a.length !== b.length) return Infinity;
    var m = 0; for (var i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  }
  function at(run, t) { // the sample taken at time t (samples are every SAMPLE_MS)
    var s = run && run.samples; if (!s) return null;
    for (var i = 0; i < s.length; i++) if (s[i].t === t) return s[i];
    return null;
  }

  // results: { [name]: { errors: [], samples: [{ t, sig: [576 numbers, a 32x18 brightness grid], state }], canvas: bool, loadError } }
  function verdict(ctrl, results) {
    var idle = results.idle || {}, checks = [], errors = [];
    Object.keys(results).forEach(function (n) { (results[n].errors || []).forEach(function (e) { if (errors.indexOf(e) < 0) errors.push(e); }); });
    checks.push({ id: 'runs', ok: !errors.length && !idle.loadError, label: 'Runs without errors', detail: errors.length ? errors.slice(0, 3).join(' | ') : (idle.loadError || '') });
    checks.push({ id: 'canvas', ok: !!idle.canvas, label: 'Draws on a canvas', detail: idle.canvas ? '' : 'no canvas with pixels to watch' });
    var s = idle.samples || [], moving = 0;
    for (var i = 1; i < s.length; i++) if (s[i].sig && s[i - 1].sig && diff(s[i].sig, s[i - 1].sig) >= DIFF) moving++; // no picture is not movement
    checks.push({ id: 'alive', ok: moving >= 3, soft: true, label: 'Screen moves on its own', detail: moving + ' of ' + Math.max(0, s.length - 1) + ' samples changed with no keys pressed' });
    var keys = ctrl.filter(function (c) { return !c.restart; }).map(function (c) {
      var run = results['key:' + c.key] || {}, best = 0;
      (run.samples || []).forEach(function (x) { if (x.t > KEY_AT) best = Math.max(best, diff(x.sig, (at(idle, x.t) || {}).sig)); });
      return { key: c.key, does: c.does, ok: best >= DIFF && best !== Infinity, change: best === Infinity ? null : Math.round(best * 10) / 10 };
    });
    var dead = keys.filter(function (k) { return !k.ok; });
    checks.push({ id: 'keys', ok: keys.length > 0 && !dead.length, label: 'Every declared key changes the screen',
      detail: keys.length ? (dead.length ? 'no effect: ' + dead.map(function (k) { return name(k.key); }).join(', ') : keys.length + ' of ' + keys.length + ' keys') : 'the game declared no keys' });
    var st = s.map(function (x) { return x.state; }).filter(Boolean), first = st[0] || {}, last = st[st.length - 1] || {};
    var mk = ((results.monkey || {}).samples || []).map(function (x) { return x.state; }).filter(Boolean), mlast = mk[mk.length - 1] || {};
    var lose = last.over === true || mlast.over === true || (num(first.lives) && num(last.lives) && last.lives < first.lives) || (num(first.lives) && num(mlast.lives) && mlast.lives < first.lives);
    checks.push({ id: 'lose', ok: !!lose, soft: true, label: 'You can lose (self-reported)', detail: lose ? 'lives dropped or game over reached in a minute of play' : 'no game over or lost life in a minute of idle play or 30 s of random keys' });
    var scored = mk.some(function (x) { return num(x.score) && num(first.score) && x.score > first.score; }) || st.some(function (x) { return num(x.score) && num(first.score) && x.score > first.score; });
    checks.push({ id: 'score', ok: !!scored, soft: true, label: 'Score goes up while playing (self-reported)', detail: scored ? '' : 'score never rose in 30 s of random keys' });
    var hard = checks.filter(function (c) { return !c.soft; });
    return { checks: checks, keys: keys, controls: ctrl, passed: hard.filter(function (c) { return c.ok; }).length, of: hard.length, playable: hard.every(function (c) { return c.ok; }) };
  }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function name(k) { return k === ' ' ? 'Space' : k; }

  // Checks that passed in one version and fail in the next.
  function regressions(before, after) {
    if (!before || !after) return [];
    var was = {}; before.checks.forEach(function (c) { was[c.id] = c.ok; });
    var out = after.checks.filter(function (c) { return was[c.id] === true && !c.ok; }).map(function (c) { return c.label; });
    var keyWas = {}; before.keys.forEach(function (k) { keyWas[k.key] = k.ok; });
    after.keys.forEach(function (k) { if (keyWas[k.key] === true && !k.ok) out.push('key ' + name(k.key)); });
    return out;
  }

  // What goes back to the model when a check fails.
  function repairNote(v) {
    var lines = [];
    v.checks.forEach(function (c) { if (!c.ok && !c.soft) lines.push('- ' + c.label + ': FAILED. ' + c.detail); });
    v.keys.forEach(function (k) { if (!k.ok) lines.push('- Holding ' + name(k.key) + ' (' + k.does + ') for 1.5 s changed nothing on screen compared with not pressing it.'); });
    return lines.join('\n');
  }

  var api = { SAMPLE_MS: SAMPLE_MS, FINE_MS: FINE_MS, KEY_HOLD: KEY_HOLD, IDLE_MS: IDLE_MS, KEY_AT: KEY_AT, DIFF: DIFF, code: code, controls: controls, plans: plans, diff: diff,
    verdict: verdict, regressions: regressions, repairNote: repairNote, keyName: name };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DA = root.DA || {}; root.DA.judge = api; }
})(typeof window !== 'undefined' ? window : this);
