/* Dream Arcade: the page. Model output only ever runs inside the sandboxed game frame; text goes in with textContent. */
(function () {
  'use strict';
  var C = window.DA.config, D = window.DA.dream, J = window.DA.judge, H = window.DA.harness, N = window.DA.net;
  var app = { key: null, prices: null, busy: false, ctrl: null, spent: 0, cur: null };

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function trusted(fn) { return function (ev) { if (ev && ev.isTrusted === false) return; fn(ev); }; }
  function say(t, warn) { var n = $('notice'); n.textContent = t || ''; n.className = 'notice' + (warn ? ' warn' : ''); }
  function fmtP(x) { return x == null ? '?' : (x < 0.001 ? x.toFixed(5) : x.toFixed(4)) + ' P'; }
  function secs(ms) { return (ms / 1000).toFixed(1) + ' s'; }

  // ---------- cost ----------
  function price() {
    var p = app.prices && app.prices[C.MODEL];
    if (!p) return null;
    var pin = +p.pricing.promptTextTokens, pout = +p.pricing.completionTextTokens;
    return pin > 0 && pout > 0 ? { pin: pin, pout: pout } : null;
  }
  function worst(messages) { // listed prices, the longest reply allowed, about 3 characters a token
    var p = price(); if (!p) return null;
    var chars = messages.reduce(function (n, m) { return n + m.content.length; }, 0);
    return (Math.ceil(chars / 3) + 200) * p.pin + C.MAX_OUT * p.pout;
  }
  function charge(res, w) { // a failed call may still be billed: without usage, count the worst case
    var p = price(), u = res && res.usage;
    return p && u && u.prompt_tokens != null ? u.prompt_tokens * p.pin + (u.completion_tokens || 0) * p.pout : w;
  }
  function blocked(messages) {
    var p = app.prices && app.prices[C.MODEL];
    if (!p) return 'Not sent: ' + C.MODEL + ' is not in the live model list right now.';
    if (p.paidOnly) return 'Not sent: ' + C.MODEL + ' is listed as paid-only right now.';
    var w = worst(messages);
    if (w == null) return 'Not sent: no listed price for ' + C.MODEL + ', so the cost cannot be checked.';
    if (app.spent + w > C.CAP) return 'Not sent: this visit has spent ≈ ' + fmtP(app.spent) + ' and the next request could pass the ' + fmtP(C.CAP) + ' cap. Reload the page to start a new visit.';
    return null;
  }
  // One model call that must return a game. Resolves to { html, ms, cost } or { error }.
  function write(messages, label) {
    var stop = blocked(messages); if (stop) return Promise.resolve({ error: stop });
    var w = worst(messages);
    say(label + ' (' + C.MODEL + ', usually 30 to 60 s)…');
    return N.chat(app.key, C.MODEL, messages, C.MAX_OUT, app.ctrl.signal).then(function (r) {
      var cost = charge(r, w); app.spent += cost; paint();
      if (!r.ok) return { error: r.cancelled ? 'Cancelled.' : 'The model call failed: ' + r.error, cost: cost };
      var html = D.extractHtml(r.text);
      if (!html) return { error: r.finish === 'length' ? 'The game was cut off at the length limit. Try a shorter dream.' : 'The reply had no complete HTML game in it.', cost: cost };
      return { html: html, ms: r.ms, cost: cost };
    });
  }

  // ---------- the bot ----------
  function playtest(html) {
    say('The bot is playing the game: 60 s idle, each key held, 30 s of random keys…');
    return H.playtest(html, C.SEED, function (i, n) { say('The bot is playing the game: run ' + (i + 1) + ' of ' + (n + 1) + '…'); });
  }

  // ---------- one game on screen ----------
  // g: { title, dream, html, model, ms, cost, versions: [{ label, verdict }], note, shared }
  function show(box, g) {
    if (box._player) box._player.remove(); // each box (yours, recorded, shared) plays one game
    box.textContent = '';
    var v = g.versions[g.versions.length - 1].verdict;
    box.appendChild(h('h3', 'gametitle', g.title));
    if (g.dream) box.appendChild(h('p', 'dream', '“' + g.dream + '”'));
    var meta = [];
    if (g.model) meta.push('written by ' + g.model);
    if (g.ms) meta.push(secs(g.ms));
    if (g.cost != null) meta.push('≈ ' + fmtP(g.cost));
    if (meta.length) box.appendChild(h('p', 'fine', meta.join(' · ')));
    if (g.note) box.appendChild(h('p', 'fine', g.note));

    var stage = h('div', 'stage'); box.appendChild(stage);
    var player = box._player = H.play(stage, g.html);
    box.appendChild(h('p', 'fine', 'Click the game, then use the keys. The buttons send the same keys (hold them on a phone).'));
    box.appendChild(pad(v.controls || [], player));

    box.appendChild(report(g));
    var acts = h('div', 'controls');
    var dl = h('button', 'btn', 'Download .html');
    dl.addEventListener('click', trusted(function () { download(g); }));
    var sh = h('button', 'btn', 'Copy share link');
    sh.addEventListener('click', trusted(function () { share(g, sh); }));
    acts.appendChild(dl); acts.appendChild(sh);
    box.appendChild(acts);
    if (g.live) box.appendChild(changeBox(g));
  }

  function pad(controls, player) {
    var wrap = h('div', 'pad');
    controls.forEach(function (c) {
      var b = h('button', 'key', J.keyName(c.key) + ' · ' + c.does);
      b.type = 'button';
      function down(e) { e.preventDefault(); player.press('keydown', c.key); b.classList.add('on'); }
      function up() { if (b.classList.contains('on')) player.press('keyup', c.key); b.classList.remove('on'); }
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function report(g) {
    var sec = h('section', 'report');
    g.versions.forEach(function (ver, i) {
      var v = ver.verdict;
      var head = h('h4', null, (g.versions.length > 1 ? ver.label + ': ' : '') + (v.playable ? 'Playable' : 'Not playable') + ' · ' + v.passed + ' of ' + v.of + ' bot checks');
      head.className = v.playable ? 'okhead' : 'nohead';
      sec.appendChild(head);
      if (ver.regressions && ver.regressions.length) sec.appendChild(h('p', 'warn', 'Broke what worked before: ' + ver.regressions.join(', ') + '.'));
      if (i < g.versions.length - 1) return; // details for the latest version only
      var ul = h('ul', 'checks');
      v.checks.forEach(function (c) {
        var li = h('li', c.ok ? 'pass' : (c.soft ? 'soft' : 'fail'));
        li.appendChild(h('span', 'mark', c.ok ? '✓' : (c.soft ? '–' : '✗')));
        li.appendChild(h('span', null, ' ' + c.label + (c.detail ? ': ' + c.detail : '')));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      if (v.keys.length) {
        var t = h('table', 'keys'), tr = h('tr');
        ['Key', 'Does', 'Screen change when held', ''].forEach(function (x) { tr.appendChild(h('th', null, x)); });
        t.appendChild(tr);
        v.keys.forEach(function (k) {
          var r = h('tr');
          r.appendChild(h('td', 'mono', J.keyName(k.key))); r.appendChild(h('td', null, k.does));
          r.appendChild(h('td', 'mono', k.change == null ? 'no picture' : String(k.change)));
          r.appendChild(h('td', k.ok ? 'pass' : 'fail', k.ok ? '✓' : '✗ dead key'));
          t.appendChild(r);
        });
        sec.appendChild(t);
      }
    });
    sec.appendChild(h('p', 'fine', 'The bot ran in your browser just now, with a fixed seed and a fake clock, so a run differs only by the keys pressed. ' +
      'Hard checks come from the picture: the game ran without errors, drew on a canvas, and every key it declares changed the screen compared with not pressing it. ' +
      'Checks marked – only report what the game says about itself (score, lives) and do not decide "Playable". The bot cannot tell whether a game is fun.'));
    return sec;
  }

  // ---------- make, repair, change ----------
  function make() {
    var dream = $('dream').value.trim();
    if (!app.key || app.busy) return;
    if (dream.length < 8) return say('Describe the game in a sentence or more.', true);
    var msgs = D.makeMessages(dream), t0 = Date.now(), cost = 0;
    begin();
    return write(msgs, 'Writing your game').then(function (r) {
      cost += r.cost || 0;
      if (r.error) throw new Error(r.error);
      var g = { title: 'Your game', dream: dream, html: r.html, model: C.MODEL, live: true, versions: [] };
      return playtest(g.html).then(function (pt) {
        g.versions.push({ label: 'First version', verdict: pt.verdict });
        if (pt.verdict.playable) return g;
        // One automatic repair: the bot's findings go back to the model.
        var fix = D.repairMessages(dream, g.html, J.repairNote(pt.verdict));
        return write(fix, 'The bot found problems; asking for a fix').then(function (r2) {
          cost += r2.cost || 0;
          if (r2.error) { g.note = 'The repair did not come back: ' + r2.error; return g; }
          return playtest(r2.html).then(function (pt2) {
            var better = pt2.verdict.passed > pt.verdict.passed || (pt2.verdict.playable && !pt.verdict.playable);
            g.versions.push({ label: 'After the bot\'s repair note', verdict: pt2.verdict, regressions: J.regressions(pt.verdict, pt2.verdict) });
            if (better) g.html = r2.html; else { g.versions.push({ label: 'Kept the first version', verdict: pt.verdict }); g.note = 'The repair was not better, so the first version is kept.'; }
            return g;
          });
        });
      }).then(function (g2) { g2.ms = Date.now() - t0; g2.cost = cost; app.cur = g2; show($('liveresult'), g2); say(''); });
    }).catch(fail).then(end);
  }

  function changeBox(g) {
    var f = h('form', 'change');
    var lab = h('label', 'field', 'Ask for a change (like "make the lava slower" or "add a rainbow cupcake worth 5 points")');
    var inp = h('input'); inp.type = 'text'; inp.maxLength = D.CHANGE_MAX; inp.className = 'textin';
    lab.appendChild(inp);
    var b = h('button', 'btn primary', 'Change it'); b.type = 'submit';
    f.appendChild(lab); f.appendChild(b);
    f.addEventListener('submit', trusted(function (e) { e.preventDefault(); change(g, inp.value.trim()); }));
    return f;
  }
  function change(g, request) {
    if (!app.key || app.busy || request.length < 3) return;
    var before = g.versions[g.versions.length - 1].verdict, t0 = Date.now();
    begin();
    write(D.changeMessages(g.dream, g.html, request), 'Making the change').then(function (r) {
      g.cost = (g.cost || 0) + (r.cost || 0);
      if (r.error) throw new Error(r.error);
      return playtest(r.html).then(function (pt) {
        var reg = J.regressions(before, pt.verdict);
        var ng = { title: 'Your game', dream: g.dream, html: r.html, model: C.MODEL, live: true, cost: g.cost, ms: Date.now() - t0,
          previous: g, versions: [{ label: 'Before "' + request + '"', verdict: before }, { label: 'After', verdict: pt.verdict, regressions: reg }] };
        if (reg.length) ng.note = 'The bot says this change broke something that worked. Ask for another change to fix it, or use Undo.';
        app.cur = ng; show($('liveresult'), ng); addUndo(ng); say('');
      });
    }).catch(fail).then(end);
  }
  function addUndo(g) {
    var u = h('button', 'btn', 'Undo the change');
    u.addEventListener('click', trusted(function () { app.cur = g.previous; show($('liveresult'), g.previous); }));
    $('liveresult').appendChild(u);
  }

  function begin() { app.busy = true; app.ctrl = new AbortController(); paint(); }
  function end() { app.busy = false; app.ctrl = null; paint(); }
  function fail(e) { say(String(e && e.message || e), true); }

  // ---------- share and download ----------
  function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) { var b = atob(s.replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
  function pack(obj) {
    var cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(JSON.stringify(obj))); w.close();
    return new Response(cs.readable).arrayBuffer().then(function (b) { return b64url(new Uint8Array(b)); });
  }
  function unpack(s) {
    var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
    w.write(unb64url(s)); w.close();
    return new Response(ds.readable).text().then(JSON.parse);
  }
  function share(g, btn) {
    if (typeof CompressionStream === 'undefined') return say('This browser cannot make share links; use Download instead.', true);
    pack({ d: g.dream || '', h: g.html }).then(function (z) {
      var url = location.origin + location.pathname + '#g=' + z;
      return navigator.clipboard.writeText(url).then(function () { btn.textContent = 'Link copied (' + Math.round(url.length / 1024) + ' KB)'; },
        function () { say('Copy failed; the link is in the address bar now.'); history.replaceState(null, '', '#g=' + z); });
    }).catch(fail);
  }
  function download(g) {
    var a = h('a'); a.href = URL.createObjectURL(new Blob([H.forDownload(g.html)], { type: 'text/html' }));
    a.download = 'dream-game.html'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function openShared() {
    var m = /^#g=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m || typeof DecompressionStream === 'undefined') return;
    unpack(m[1]).then(function (o) {
      if (!o || typeof o.h !== 'string' || o.h.length > 400000) throw new Error('not a game link');
      $('shared').hidden = false;
      return playtest(o.h).then(function (pt) {
        show($('sharedresult'), { title: 'A shared game', dream: String(o.d || '').slice(0, D.DREAM_MAX), html: o.h, versions: [{ label: 'Shared', verdict: pt.verdict }],
          note: 'Someone made this and shared the link. It runs sandboxed with no network, and the bot just checked it in your browser.' });
        say('');
      });
    }).catch(function (e) { say('That share link could not be opened: ' + (e && e.message || e), true); });
  }

  // ---------- recorded games ----------
  function loadRecordings() {
    fetch('recordings/games.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (rec) {
      $('recmeta').textContent = rec.note || '';
      rec.games.forEach(function (x) {
        var b = h('button', 'take', x.title);
        b.addEventListener('click', trusted(function () { openRecording(x, b); }));
        $('shots').appendChild(b);
      });
    }).catch(function (e) { $('recmeta').textContent = 'Recordings unavailable: ' + e.message; });
  }
  function openRecording(x, b) {
    if (app.busy) return;
    [].forEach.call($('shots').children, function (c) { c.classList.toggle('sel', c === b); });
    begin();
    fetch('recordings/' + x.file, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (html) {
      return playtest(html).then(function (pt) {
        show($('recresult'), { title: x.title, dream: x.dream, html: html, model: x.model, ms: x.ms, cost: x.cost, versions: [{ label: 'Recorded', verdict: pt.verdict }],
          note: 'A recorded reply from the model. The bot report below was not stored: the bot played it in your browser just now.' });
        say('');
      });
    }).catch(fail).then(end);
  }

  // ---------- sign-in ----------
  function readKey(c, e) {
    var k = (c && c.apiKey) || (e && e.detail && (e.detail.apiKey || e.detail.key)) || null;
    return typeof k === 'string' && k ? k : null;
  }
  function wireConnect() {
    var c = $('connect');
    Promise.race([customElements.whenDefined('polli-connect'), new Promise(function (r) { setTimeout(r, 8000); })]).then(function () {
      if (!customElements.get('polli-connect')) { c.hidden = true; $('connect-fallback').hidden = false; }
      onKey(readKey(c));
    });
    c.addEventListener('change', function (e) { onKey(readKey(c, e)); });
  }
  function onKey(k) { if (k === app.key) return; app.key = k; if (!k && app.ctrl) app.ctrl.abort(); paint(); }

  function paint() {
    var signed = !!app.key;
    $('signin').hidden = signed;
    $('make').disabled = !signed || app.busy;
    $('cancel').hidden = !app.ctrl;
    var w = worst(D.makeMessages($('dream').value || 'x'));
    $('cost').textContent = w == null ? '' : 'At most ' + fmtP(w) + ' to write a game, and the same again if the bot asks for a repair, from listed prices.';
    $('spent').hidden = !app.spent; $('spent').textContent = 'spent ≈ ' + fmtP(app.spent);
  }

  function init() {
    $('make').addEventListener('click', trusted(make));
    $('cancel').addEventListener('click', trusted(function () { if (app.ctrl) app.ctrl.abort(); }));
    $('dream').maxLength = D.DREAM_MAX;
    $('model').textContent = C.MODEL;
    $('src').href = C.REPO_URL;
    wireConnect();
    N.prices().then(function (p) { app.prices = p; paint(); }).catch(function (e) { say('Model list unavailable: ' + e.message, true); });
    loadRecordings();
    openShared();
    paint();
  }
  init();
})();
