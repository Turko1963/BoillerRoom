/* Bull vs Bear: the only file that talks to the BullBear component in the room.
   It listens to the room's 'boilerroom:*' events and drives the arena. If anything here fails,
   the strip is removed and the room carries on exactly as without it. */
(function () {
  'use strict';
  var dock = document.getElementById('bb-dock');
  try {
    if (!dock) return;
    if (!window.BullBear || typeof BullBear.createArena !== 'function') throw new Error('component not loaded');
    var root = document.documentElement;
    var arena = BullBear.createArena(dock, {
      isDark: function () { return root.dataset.theme === 'dark'; },
      assets: { bull: '/bullbear/assets/bull.webp', bear: '/bullbear/assets/bear.webp' }
    });

    // each desk that has reported: its stance, confidence and vote weight in the current mode
    var desks = {};
    var sums = function () {
      var t = { bull: 0, bear: 0, neutral: 0 };
      for (var id in desks) t[desks[id].stance] += desks[id].conf * desks[id].weight;
      return t;
    };
    var side = function (st) { return st === 'bull' || st === 'bear' ? st : 'neutral'; };
    var lines = {
      report: function (n, st) { return st === 'bull' ? n + ' scores for the bulls' : st === 'bear' ? n + ' swings for the bears' : n + ' sits on the fence'; },
      speak: function (n, st) { return st === 'bull' ? n + ' charges for the bulls' : st === 'bear' ? n + ' swings for the bears' : n + ' weighs in from the middle'; },
      vote: function (n, st) { return 'Final round. ' + n + (st === 'bull' ? ' backs the bulls' : st === 'bear' ? ' backs the bears' : ' stays neutral'); }
    };
    var on = function (name, fn) {
      addEventListener('boilerroom:' + name, function (e) {
        try { fn(e.detail || {}); } catch (err) { if (window.console) console.warn('[bullbear]', err); }
      });
    };

    // sounds (public/sfx.js, optional): a whoosh as the attacker charges, the blow, the animal's call, the winner
    var sfx = function (f, a) { try { if (window.SFX) window.SFX[f](a); } catch (e) {} };
    var fight = function (st) {
      if (st !== 'bull' && st !== 'bear') return;
      sfx('whoosh');
      setTimeout(function () { sfx('hit', .9); sfx(st === 'bull' ? 'snort' : 'growl'); }, 520);
    };
    var fresh = function () { for (var k in desks) delete desks[k]; arena.reset('The bell rings'); };
    on('brief', fresh);
    on('scout', fresh);
    on('report', function (d) {
      desks[d.id] = { stance: side(d.stance), conf: +d.conf || 0, weight: +d.weight || 1 };
      arena.setVotes(sums());
      arena.hit(side(d.stance), lines.report(d.name, d.stance));
      fight(side(d.stance));
    });
    on('speak', function (d) { arena.hit(side(d.stance), lines.speak(d.name, d.stance)); });
    on('change', function (d) {
      var before = sums();
      desks[d.id] = { stance: side(d.stance), conf: +d.conf || 0, weight: +d.weight || (desks[d.id] && desks[d.id].weight) || 1 };
      var after = sums(), gain = (after.bull - before.bull) - (after.bear - before.bear);
      var gained = gain > 0 ? 'bull' : gain < 0 ? 'bear' : 'neutral';
      arena.setVotes(after);
      arena.hit(gained, d.from !== d.stance
        ? d.name + ' changes sides. The ' + (gained === 'bull' ? 'bulls' : gained === 'bear' ? 'bears' : 'middle') + ' gain ground'
        : d.name + (d.conf < d.oldConf ? ' backs off. ' : ' digs in. ') + (gained === 'neutral' ? 'Nobody gains' : 'The ' + (gained === 'bull' ? 'bulls' : 'bears') + ' gain ground'));
    });
    on('vote', function (d) { arena.hit(side(d.stance), lines.vote(d.name, d.stance)); });
    on('decision', function (d) {
      var w = d.call === 'Buy' ? 'bull' : d.call === 'Hold' ? 'draw' : 'bear';
      arena.end(w);
      if (w !== 'draw') setTimeout(function () { fight(w); setTimeout(function () { sfx('win', w); }, 900); }, 1400);
    });

    window.BB_ADAPTER_OK = true;
  } catch (err) {
    if (window.console) console.warn('[bullbear] turned off:', err && err.message);
    if (dock && dock.parentNode) dock.parentNode.removeChild(dock);
  }
})();
