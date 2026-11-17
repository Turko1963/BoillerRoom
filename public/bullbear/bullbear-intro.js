/* Bull vs Bear in the BackStage Capital intro: the only file that talks to the intro fight.
   The intro calls BBIntro.start(film) right after the market line shatters. `film` gives the
   hooks back into the existing film; anything that fails returns null and the film plays as before. */
(function () {
  'use strict';
  window.BBIntro = {
    start: function (film) {
      try {
        if (!window.BullBear || typeof BullBear.createIntroFight !== 'function') return null;
        // sounds (public/sfx.js, optional; silent until the visitor has clicked or typed on the page)
        var sfx = function (f, x) { try { if (window.SFX) window.SFX[f](x); } catch (e) {} };
        sfx('snort'); setTimeout(function () { sfx('growl'); }, 700);
        return BullBear.createIntroFight(film.el, {
          assets: { bull: '/bullbear/assets/bull.webp', bear: '/bullbear/assets/bear.webp' },
          onFrame: function (f) { film.aim(f.bull, f.bear); },                  // spotlights follow the animals
          onImpact: function (power, x, y) { film.push(power, x, y); sfx('whoosh'); setTimeout(function () { sfx('hit', power); }, 60); }, // blows push the particles
          onVictory: function () { film.caption('This is where the bulls win.'); sfx('win', 'bull'); },
          onFinish: function (x, y) { film.burst(x, y); }                      // the logo forms from the bull
        });
      } catch (err) {
        if (window.console) console.warn('[bullbear] intro fight skipped:', err && err.message);
        return null;
      }
    }
  };
})();
