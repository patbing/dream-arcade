const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../js/dream.js');

test('makeMessages: the contract as system, the dream trimmed to its limit', () => {
  const m = D.makeMessages('  a fox   jumps ' + 'x'.repeat(900));
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /window\.__play/);
  assert.equal(m[1].content.length, D.DREAM_MAX);
  assert.ok(m[1].content.startsWith('a fox jumps'));
});

test('repair and change messages carry the previous game and the request', () => {
  const r = D.repairMessages('dream', '<html></html>', '- Holding a changed nothing');
  assert.equal(r.length, 4);
  assert.match(r[2].content, /^```html\n<html><\/html>/);
  assert.match(r[3].content, /Holding a changed nothing/);
  const c = D.changeMessages('dream', '<html></html>', 'make the cupcakes faster');
  assert.match(c[3].content, /"make the cupcakes faster"/);
});

test('extractHtml: fenced, bare, and cut-off replies', () => {
  assert.equal(D.extractHtml('Here:\n```html\n<!doctype html><html><body><script>1</script></body></html>\n```'), '<!doctype html><html><body><script>1</script></body></html>');
  assert.equal(D.extractHtml('<!DOCTYPE html><html><script>x</script></html> trailing'), '<!DOCTYPE html><html><script>x</script></html>');
  assert.equal(D.extractHtml('```html\n<!doctype html><html><body><canvas>'), null); // no closing fence: cut off
  assert.equal(D.extractHtml('```html\n<div>no script, no end</div>\n```'), null);
  assert.equal(D.extractHtml(''), null);
});
