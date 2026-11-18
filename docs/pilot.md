# Pilot, 2026-11-18

Five dreams (platformer, catcher, shooter, a kid's run-on sentence, a two-player fighter), one request each to two free models, `max_tokens` 16000, random seed per request. Spent ≈ 0.154 Pollen, failed requests included.

| Model | Games returned | Time | Cost per game | Passed the bot |
|---|---|---|---|---|
| openai/gpt-6.1-terra | 5 of 6 requests (one HTTP 503, retried) | 31–43 s | ≈ 0.02 P | 5 of 5 |
| deepseek/deepseek-v4.1-flash | 2 of 5 (two connections closed near 270 s, one cut off at the length limit) | 119–270 s | ≈ 0.006 P | 2 of 2 |

The pilot also fixed the bot. A hidden frame reports a 0×0 window, so bot runs now fix it at 640×360. A 16×9 picture missed small ships and bullets, so it is 32×18. A 0.2 s punch fell between 250 ms samples, so samples are every 50 ms while a key is held. A restart key does nothing before game over, so the bot does not hold it. A two-player fighter stands still when nobody presses anything, so "moves on its own" only reports.

Not yet seen with a real model: a game that fails the bot and is repaired. The repair and change paths are tested with handwritten games.
