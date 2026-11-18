/* Dream Arcade: what the model is asked, and how its reply becomes a game. Pure; browser (window.DA.dream) and node. */
(function (root) {
  'use strict';

  var DREAM_MAX = 600, CHANGE_MAX = 300;

  // The contract the playtest bot checks. Pilot-tested: 7 of 7 games that came back followed it (docs/pilot.md).
  var CONTRACT = [
    "You are a game developer. Turn the player's dream into ONE complete, playable HTML5 game in a single file.",
    'Rules (a test bot will play your game and check them):',
    '1. One self-contained HTML file: inline <style> and <script> only. No external URLs, no fetch, no images or fonts by URL. Draw everything with canvas shapes and text.',
    '2. One <canvas> that fills the window (resize it on window resize). Draw the whole game on it, with requestAnimationFrame.',
    '3. The game starts playing immediately on load: no title screen, no "click to start", no "press any key".',
    '4. Keyboard only: listen for keydown/keyup on window and use event.key ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " " for Space, or single lowercase letters like "a", "f"). Track held keys so holding a key keeps acting. Call preventDefault for arrow keys and Space. Do not build touch buttons; the host page sends key events.',
    '5. The game must be losable (lives or health that run out, then a game over screen) and must have a score. After game over, the Enter key restarts.',
    '6. Never use alert, prompt, confirm, localStorage, sessionStorage, cookies, or audio files. Use Math.random for randomness and the requestAnimationFrame timestamp or performance.now for time.',
    '7. Expose this object exactly:',
    'window.__play = {',
    '  controls: [ { key: "ArrowLeft", does: "move left" }, ... ],   // every key the game uses, max 8, each must visibly change the screen while held',
    '  state() { return { score: <number>, lives: <number>, over: <boolean>, won: <boolean> }; }',
    '};',
    '8. Make it fun and true to the dream: the things the player described must be in the game and recognisable. Show score and lives on screen, and a one-line hint of the controls.',
    'Reply with the complete HTML file in one ```html code block and nothing else.'
  ].join('\n');

  function clip(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); }
  function fence(html) { return '```html\n' + html + '\n```'; }

  function makeMessages(dream) {
    return [{ role: 'system', content: CONTRACT }, { role: 'user', content: clip(dream, DREAM_MAX) }];
  }
  // A repair: the bot's findings go back with the game it played.
  function repairMessages(dream, html, note) {
    return makeMessages(dream).concat([
      { role: 'assistant', content: fence(html) },
      { role: 'user', content: 'A test bot played your game and found these problems:\n' + note + '\nFix them. Keep everything that works. Reply with the complete fixed HTML file in one ```html code block.' }
    ]);
  }
  // A change the player asks for, like the family in the linked post asking for a Hulk smash.
  function changeMessages(dream, html, request) {
    return makeMessages(dream).concat([
      { role: 'assistant', content: fence(html) },
      { role: 'user', content: 'The player asks for a change: "' + clip(request, CHANGE_MAX) + '"\nMake it. Keep the rules above and everything else that works. Reply with the complete updated HTML file in one ```html code block.' }
    ]);
  }

  // The game from a reply: the ```html block, or a bare document. Null when there is none or it is cut off.
  function extractHtml(text) {
    var t = String(text || ''), m = /```html\s*([\s\S]*?)```/i.exec(t) || /(<!doctype html[\s\S]*<\/html>)/i.exec(t);
    var h = m ? m[1].trim() : '';
    return /<\/html>\s*$/i.test(h) || /<\/script>/i.test(h) ? h : null;
  }

  var api = { DREAM_MAX: DREAM_MAX, CHANGE_MAX: CHANGE_MAX, CONTRACT: CONTRACT, makeMessages: makeMessages, repairMessages: repairMessages, changeMessages: changeMessages, extractHtml: extractHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DA = root.DA || {}; root.DA.dream = api; }
})(typeof window !== 'undefined' ? window : this);
