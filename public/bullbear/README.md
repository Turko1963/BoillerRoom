# BullBear component

A bull against bear fight for the Boiler Room, as a drop-in component.
It has two parts: the **arena** (a fight strip driven by what the desks say) and the **intro fight** (the big fight for the intro film).
No dependencies, no build step, nothing global except `window.BullBear`. Every CSS class starts with `bb-`.

## Files

| File | What it is |
|---|---|
| `bullbear.js` | The component (about 32 KB, not minified) |
| `bullbear.css` | Its styles |
| `assets/bull.webp`, `assets/bear.webp` | The two pictures, already cut out and facing each other |
| `bullbear.assets.js` | Optional. The same two pictures embedded as data, so nothing has to be hosted |
| `demo.html` | Open it to see everything working, with a button for every call |

## Quick start

```html
<link rel="stylesheet" href="bullbear.css">
<script src="bullbear.js"></script>
<!-- either host the assets folder, or load the embedded pictures: -->
<script src="bullbear.assets.js"></script>

<div id="fight"></div>
<script>
  const arena = BullBear.createArena(document.getElementById('fight'), {
    isDark: () => document.documentElement.dataset.theme === 'dark'   // optional
    // assets: { bull: '/img/bull.webp', bear: '/img/bear.webp' },    // optional
    // crossOrigin: 'anonymous',                                      // only if the pictures are on another domain (needs CORS headers)
  });
</script>
```

## Arena API

| Call | When to call it in the Boiler Room | What happens |
|---|---|---|
| `arena.reset(message?)` | A new brief starts, or the Scout launches | Both go back to their corners, score 50 / 50 |
| `arena.setVotes({ bull, bear, neutral })` | After every report and every change of mind | Moves the fight toward the losing side, updates the percentages and the bar. Pass the summed weight of each side (confidence x desk weight in the current mode) |
| `arena.setBalance(bal, bullPct?)` | Alternative to `setVotes` | `bal` from -1 (bears) to 1 (bulls) |
| `arena.hit(side, message?)` | A desk reports, a bot speaks in the debate, a bot changes its mind, a bot votes | `side` is `'bull'`, `'bear'` or `'neutral'`. That side attacks. `message` is the commentary line |
| `arena.end(result)` | The manager announces the decision | `'bull'` (Buy), `'bear'` (Short or Sell) or `'draw'` (Hold). Plays the last charge and the knockout |
| `arena.say(message)` | Any time | Changes the commentary line only |
| `arena.destroy()` | The room is torn down | Removes everything |

Options: `assets`, `crossOrigin`, `isDark` (function), `typeSpeed` (ms per two letters, 0 for instant), `labels` (all visible text, see the top of `createArena`), `onKnockout(result)`.

The first `hit` after a `reset` makes them walk to the middle. Between calls they keep fighting on their own, and the side that is ahead attacks more often.

### The mapping used in the prototype

```js
// new brief
arena.reset('The bell rings');
// a desk files its report (stance is 'bull' | 'bear' | 'neutral')
arena.setVotes(sumsBySide()); arena.hit(stance, `${deskName} scores for the bulls`);
// a bot speaks during the debate
arena.hit(speakerStance, `${deskName} swings for the bears`);
// a bot changes its mind or its confidence
arena.setVotes(sumsBySide()); arena.hit(sideThatGained, `${deskName} backs off. The bears gain ground`);
// each vote
arena.hit(stance, `Final round. ${deskName} backs the bulls`);
// decision
arena.end(call === 'Buy' ? 'bull' : call === 'Hold' ? 'draw' : 'bear');
```

## Intro fight API

```js
const fight = BullBear.createIntroFight(introElement, {   // introElement must be positioned (relative, absolute or fixed)
  floor: .72,                         // where the ground is, as a fraction of the element's height
  onClash:    () => {},               // first collision
  onImpact:   (power, x, y) => {},    // every blow, for example to push your own particles
  onKnockout: () => {},               // the bear is thrown
  onVictory:  () => {},               // show the caption "This is where the bulls win."
  onFinish:   (x, y) => {},           // the bull bursts at x, y: start forming the logo here
  onFrame:    ({ bull, bear }) => {}  // centres of both animals, for example to aim spotlights
});
// fight.skip()    jump to the end (calls onFinish)
// fight.destroy() remove it
// fight.duration  11.4 seconds
```

It draws its own dust, sparks, rings and flash, and removes itself 2.5 seconds after `onFinish`.
The bull always wins this one. That is by design.

## Theming

Set any of these on `.bb-arena` or a parent: `--bb-up`, `--bb-down`, `--bb-ink`, `--bb-ink-2`, `--bb-ink-3`, `--bb-line`, `--bb-surface`, `--bb-display-font`, `--bb-height` (strip height, default 100px), `--bb-bull-w`, `--bb-bull-h`, `--bb-bear-w`, `--bb-bear-h`.
Example to match the Boiler Room: `.bb-arena{--bb-up:var(--up);--bb-down:var(--down);--bb-ink:var(--ink);--bb-ink-2:var(--ink-2);--bb-ink-3:var(--ink-3);--bb-line:var(--line);--bb-surface:var(--glass);--bb-display-font:var(--display)}`

## Things to know before integrating

- **Layout.** The arena is a block 100px tall that fills the width of its container. The animals stand a little taller than the strip and the loser is thrown above it, so the container and its parents must not clip (`overflow: visible`) for about 150px above the strip.
- **Scaling.** The component measures itself with layout sizes, so it keeps working inside a parent that uses `transform: scale()`.
- **The moving body parts** are done by bending each picture with WebGL. If WebGL is not available, or the user prefers reduced motion, the animals still move and fight as whole pictures.
- **Pictures on another domain** need CORS headers and the `crossOrigin` option, otherwise WebGL refuses them and the component falls back to whole pictures.
- **Swapping the pictures.** The joints are mapped to these two pictures (bull 778 x 760, bear 695 x 760, bull facing right, bear facing left). A cleaner copy of the same artwork works as is. Different artwork needs new joint coordinates in `SPEC` at the top of `bullbear.js`.
- **Licence.** The two pictures are watermarked previews from a stock site, used here as placeholders. Buy the licensed versions before anyone outside the company sees this, then replace the two files.
- **Cost.** Two small WebGL canvases for the arena and two more while the intro fight plays. The intro ones are released when it ends.
