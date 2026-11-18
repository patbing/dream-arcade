/* Dream Arcade configuration. Classic script. */
(function () {
  'use strict';
  window.DA = window.DA || {};
  window.DA.config = {
    // Public App Key (pk_...) registered for this page's address. Safe to commit.
    APP_KEY: 'pk_0LE1zSCRF2udEk3U',
    REPO_URL: 'https://github.com/patbing/dream-arcade',
    API: 'https://gen.pollinations.ai',
    // Free (paid_only: false), checked against the live model list when the page loads. Pilot: 30-45 s a game, about 0.02 Pollen.
    MODEL: 'openai/gpt-6.1-terra',
    MAX_OUT: 16000,
    TIMEOUT_MS: 240000,
    // Pollen this page may spend per visit, from listed prices. A request that could pass it is not sent.
    CAP: 0.5,
    SEED: 20261118 // the bot's seed: every run of a game draws the same frames
  };
})();
