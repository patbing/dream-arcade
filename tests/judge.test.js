// node --test tests/  — the judge decides "playable" from screen samples only; these pin its rules.
const test = require('node:test'), assert = require('node:assert/strict');
const J = require('../js/judge.js');

const flat = v => Array(144).fill(v);
const moved = (v, cell, by) => { const s = flat(v); s[cell] += by; return s; };
// idle: a screen that changes a little every sample (alive), with optional self-reported state
function idleRun(n, state) { return { errors: [], canvas: true, samples: Array.from({ length: n }, (_, i) => ({ t: i * 250, sig: moved(50, i % 144, 10), state: state ? state(i) : null })) }; }
function keyRun(idle, changeBy) { return { errors: [], canvas: true, samples: idle.samples.slice(0, 13).map(s => ({ t: s.t, sig: s.t > J.KEY_AT ? s.sig.map((v, i) => i === 140 ? v + changeBy : v) : s.sig, state: null })) }; }

test('controls: normalizes Space and letters, drops unknown and duplicate keys, caps at 8', () => {
  const c = J.controls([{ key: 'Space', does: 'jump' }, { key: 'A', does: 'left' }, { key: 'a' }, { key: 'F13' }, { key: 'ArrowUp' }]);
  assert.deepEqual(c.list.map(x => x.key), [' ', 'a', 'ArrowUp']);
  assert.equal(c.dropped, 2);
  assert.equal(J.controls('nope').list.length, 0);
  assert.equal(J.controls(Array.from({ length: 12 }, (_, i) => ({ key: String.fromCharCode(97 + i) }))).list.length, 8);
});

test('controls: a restart key is not held by the bot or required to change the screen', () => {
  const c = J.controls([{ key: 'ArrowLeft', does: 'move' }, { key: 'Enter', does: 'Restart after game over' }]).list;
  assert.deepEqual(J.plans(c, Math.random).map(x => x.name), ['idle', 'key:ArrowLeft', 'monkey']);
  const idle = idleRun(240);
  assert.equal(J.verdict(c, { idle, 'key:ArrowLeft': keyRun(idle, 40) }).playable, true);
});

test('plans: idle, one hold per key, and a reproducible monkey', () => {
  const ctrl = [{ key: 'ArrowLeft' }, { key: ' ' }];
  const seeded = () => { let a = 7; return () => (a = (a * 16807) % 2147483647) / 2147483647; };
  const p = J.plans(ctrl, seeded());
  assert.deepEqual(p.map(x => x.name), ['idle', 'key:ArrowLeft', 'key: ', 'monkey']);
  assert.deepEqual(p[1].events.map(e => e.t), [1000, 2500]);
  assert.deepEqual(J.plans(ctrl, seeded())[3].events, p[3].events);
  assert.ok(p[3].events.every(e => e.t < 30000));
  assert.deepEqual(J.plans([]).map(x => x.name), ['idle']);
});

test('diff: largest single-cell change; mismatched or missing is Infinity', () => {
  assert.equal(J.diff(flat(10), moved(10, 5, 7)), 7);
  assert.equal(J.diff(flat(1), null), Infinity);
  assert.equal(J.diff([1, 2], [1]), Infinity);
});

test('verdict: a working game is playable', () => {
  const idle = idleRun(240, i => ({ score: i, lives: i > 100 ? 2 : 3 }));
  const v = J.verdict([{ key: 'ArrowLeft', does: 'move' }], { idle, 'key:ArrowLeft': keyRun(idle, 40) });
  assert.equal(v.playable, true);
  assert.equal(v.passed, 3); // runs, canvas, keys; alive/lose/score only report
  assert.ok(v.checks.find(c => c.id === 'lose').ok);
});

test('verdict: a dead key fails, and the repair note names it', () => {
  const idle = idleRun(240);
  const v = J.verdict([{ key: 'ArrowLeft', does: 'move' }, { key: 'ArrowRight', does: 'move right' }],
    { idle, 'key:ArrowLeft': keyRun(idle, 40), 'key:ArrowRight': keyRun(idle, 0) });
  assert.equal(v.playable, false);
  assert.deepEqual(v.keys.map(k => k.ok), [true, false]);
  assert.match(J.repairNote(v), /Holding ArrowRight \(move right\)/);
});

test('verdict: self-reported state cannot make a frozen screen playable', () => {
  const frozen = { errors: [], canvas: true, samples: Array.from({ length: 240 }, (_, i) => ({ t: i * 250, sig: flat(30), state: { score: i, lives: 3 - (i > 9), over: i > 200 } })) };
  const v = J.verdict([{ key: ' ', does: 'jump' }], { idle: frozen, 'key: ': { samples: frozen.samples.slice(0, 13) } });
  assert.equal(v.playable, false);
  assert.equal(v.checks.find(c => c.id === 'alive').ok, false);
  assert.equal(v.checks.find(c => c.id === 'score').ok, true); // soft checks only report
});

test('verdict: samples with no picture do not count as a moving screen', () => {
  const blank = { errors: [], canvas: false, samples: Array.from({ length: 240 }, (_, i) => ({ t: i * 250, sig: null, state: null })) };
  assert.equal(J.verdict([], { idle: blank }).checks.find(c => c.id === 'alive').ok, false);
});

test('verdict: errors and missing canvas fail; no declared keys fails', () => {
  const idle = idleRun(240); idle.errors = ['player is not defined'];
  const v = J.verdict([], { idle });
  assert.equal(v.checks.find(c => c.id === 'runs').ok, false);
  assert.equal(v.checks.find(c => c.id === 'keys').ok, false);
  assert.equal(J.verdict([], { idle: { loadError: 'stuck' } }).checks.find(c => c.id === 'canvas').ok, false);
});

test('regressions: lists checks and keys that passed before and fail after', () => {
  const idle = idleRun(240), ctrl = [{ key: 'ArrowLeft', does: 'move' }];
  const before = J.verdict(ctrl, { idle, 'key:ArrowLeft': keyRun(idle, 40) });
  const after = J.verdict(ctrl, { idle, 'key:ArrowLeft': keyRun(idle, 0) });
  assert.deepEqual(J.regressions(before, after), ['Every declared key changes the screen', 'key ArrowLeft']);
  assert.deepEqual(J.regressions(after, before), []);
});
