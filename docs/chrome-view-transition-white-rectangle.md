# Chrome View Transition white-rectangle artifact

Status: reproduced; cause narrowed to Chrome's composited View Transition
surfaces, not yet proven

Last reviewed: 2026-08-27

## Summary

Chrome can briefly display a white rectangle at the top of the viewport while
navigating between routes from the top navigation. It sometimes appears with a
second white rectangle over the page-title snapshot, then fades with the rest
of the transition. The fault is intermittent at normal speed but becomes easy
to see when Chrome replays the transition at 10% speed.

The artifact was reproduced in a headed Chrome for Testing 151.0.7922.34
session at a 1440 x 1000 viewport in the dark theme. A 32-navigation run at
normal speed caught it repeatedly, including on Software -> Photography and
Home -> About edges. An additional eight navigations at 10% speed held the
faulty surfaces on screen for several seconds. The same normal-speed run in
headless Chrome's software-rendered path did not show the artifact.

One captured sequence showed three distinct failures in the same transition:

- a page-wide white strip extending down from the viewport's top edge;
- a separate white rectangle matching the page-title snapshot bounds; and
- the remainder of the outgoing page temporarily composited as pale grey.

The top navigation continued to render correctly above all three areas. This
is consistent with a stale or uninitialized View Transition surface, rather
than a white element being inserted into the document.

This note records the evidence and the inspection procedure. It does not yet
select a production fix.

## Relevant implementation

The navigation architecture is documented in
[Whole-page navigation animation architecture](./whole-page-navigation-animation-plan.md).
The transition deliberately divides the screen into independently composited
snapshots:

- `src/styles/view-transitions.css` gives the fixed backdrop, root, top
  navigation, page title, and some shared elements their own View Transition
  groups.
- The root old/new images translate, scale, and fade, while `top-nav` remains
  stationary above them.
- `src/styles/global.css` assigns `page-title` to `.page-heading`.
- The top navigation panel uses `backdrop-filter` and
  `-webkit-backdrop-filter`, which introduce another composited/filtering
  surface.
- `src/scripts/navigation-transitions/client-router.ts` confirms that Chrome
  takes the `same-document-native` path and carries transition and theme state
  across Astro's document swap.

The independent root, `page-title`, `page-backdrop`, and `top-nav` surfaces
match the boundaries visible in the failed frames. The navigation backdrop
filter may contribute to Chrome's surface ordering, but the current evidence
does not prove that it is the trigger.

## Reproduce at normal speed

1. Run `npm run dev`.
2. Open the local site in Chrome with hardware acceleration enabled.
3. Select the dark theme so a white or pale surface is immediately visible.
4. Use a desktop viewport near 1440 x 1000. If DevTools is open, undock it so
   it does not continually change the page viewport.
5. Alternate between Software and Photography, or between Home and About.
   Ten to twenty transitions are usually enough to catch an occurrence.

Do not enable `prefers-reduced-motion` for this test. The site intentionally
cancels the relevant animations under that preference, which hides the
problem rather than exercising it.

## Capture an intermittent occurrence

Use the Performance panel when the artifact is too brief to inspect live:

1. Open DevTools -> Performance.
2. Open capture settings and enable **Screenshots**.
3. Start a runtime recording.
4. Cycle the top-navigation routes at normal speed until the rectangle
   appears, or for approximately 20 transitions.
5. Stop recording.
6. Scrub the screenshot filmstrip, or select individual entries in the Frames
   track, to locate the exact faulty frame.
7. With advanced paint instrumentation enabled, select that frame and inspect
   its Layers tab.
8. Save the trace together with the Chrome version from `chrome://version` and
   GPU feature status from `chrome://gpu` if the issue will be reported to
   Chromium.

Chrome's Performance documentation describes screenshot-per-frame capture and
the frame Layers view:
<https://developer.chrome.com/docs/devtools/performance/reference>.

## Pause and scrub the View Transition

Chrome's Animations panel understands View Transition animations and exposes
their temporary pseudo-element tree:
<https://developer.chrome.com/docs/devtools/css/animations/>.

1. Open the Command Menu with `Ctrl+Shift+P` or `Cmd+Shift+P`.
2. Run **Show Animations**.
3. Click the Animations panel's pause button before triggering navigation.
4. Click a non-active top-navigation destination. DevTools captures the
   transition and immediately pauses it.
5. Select the captured animation group.
6. Set playback to 10%, replay it, or drag the red playhead to scrub through
   approximately 0-250 ms.
7. While paused, open Elements. Chrome places the temporary
   `::view-transition` pseudo-element tree above `<head>`.

Inspect these branches first:

```text
::view-transition-group(root)
::view-transition-old(root)
::view-transition-new(root)
::view-transition-group(page-title)
::view-transition-old(page-title)
::view-transition-new(page-title)
::view-transition-group(top-nav)
::view-transition-group(page-backdrop)
```

In Elements -> Styles, compare each branch's bounds, background, opacity,
transform, overflow, and z-index. Temporarily toggling one group at a time can
show which surface owns a visible rectangle without modifying repository
files.

## Deterministic Console pause

The following Console helper was validated against this site. It wraps the
same-document View Transition API, pauses only View Transition animations as
soon as their pseudo-elements exist, and exposes a millisecond step control.

```js
(() => {
  window.__vtDebug?.restore?.();

  const original = document.startViewTransition.bind(document);
  const debug = window.__vtDebug = {
    animations: [],
    transition: null,
    at(milliseconds) {
      for (const animation of this.animations) {
        animation.currentTime = milliseconds;
      }
    },
    play() {
      for (const animation of this.animations) animation.play();
    },
    restore() {
      this.play();
      document.startViewTransition = original;
    },
  };

  document.startViewTransition = (...args) => {
    const transition = original(...args);
    debug.transition = transition;

    transition.ready.then(() => {
      debug.animations = document
        .getAnimations({ subtree: true })
        .filter((animation) =>
          animation.effect?.pseudoElement?.startsWith('::view-transition')
        );

      for (const animation of debug.animations) animation.pause();

      console.table(debug.animations.map((animation) => ({
        pseudoElement: animation.effect?.pseudoElement,
        duration: animation.effect?.getComputedTiming().duration,
        currentTime: animation.currentTime,
        playState: animation.playState,
      })));
    });

    return transition;
  };
})();
```

After pasting it, trigger one navigation. Step through likely failure frames
with:

```js
__vtDebug.at(20);
__vtDebug.at(60);
__vtDebug.at(100);
__vtDebug.at(140);
__vtDebug.at(180);
__vtDebug.at(220);
```

Run `__vtDebug.play()` to finish the frozen transition and
`__vtDebug.restore()` to remove the wrapper.

The validated capture exposed 11 paused View Transition animations on a Home
-> Software edge, including the root, page backdrop, page title, and incoming
software-title snapshots.

## Rendering diagnostics

Open the Rendering panel from the Command Menu and enable:

- **Paint flashing**, which marks repainted pixels in green;
- **Layer borders**, which outlines compositor layers and tiles; and
- **Frame rendering stats**, which helps correlate the artifact with a dropped
  or delayed frame.

If the white area appears without a matching green repaint, it strengthens the
case that the rectangle is produced during layer composition rather than by a
DOM paint. Chrome documents these diagnostics at
<https://developer.chrome.com/docs/devtools/rendering/performance>.

## Comparison matrix

Repeat a short capture under each condition and record whether the artifact is
present:

| Condition | Diagnostic value |
| --- | --- |
| Headed Chrome, hardware acceleration enabled | Baseline affected path. |
| Headed Chrome, hardware acceleration disabled | Tests dependence on GPU composition. |
| Chrome Incognito | Removes extension interference. |
| Dark and light site themes | Distinguishes a white surface from the intended canvas color. |
| 100%, 25%, and 10% playback | Locates the first faulty animation interval. |
| `page-title` group temporarily disabled in DevTools | Tests the title snapshot boundary. |
| Nav `backdrop-filter` temporarily disabled in DevTools | Tests interaction with the filtered nav surface. |
| Root transform/scale temporarily disabled in DevTools | Tests movement of the root snapshot texture. |

These DevTools experiments should remain temporary until one property is shown
to control the artifact consistently. A production code change should then be
verified across Chrome, Firefox, reduced motion, both themes, and the full
route relationship matrix.
