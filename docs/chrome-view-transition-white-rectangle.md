# Chrome View Transition white-rectangle artifact

Status: reproduced; isolated to Chrome's headed Ozone/Wayland GPU-compositing
path on the tested Linux system

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
faulty surfaces on screen for several seconds.

Follow-up testing isolated the affected environment more precisely. The test
host runs Fedora Linux 44 with KDE Plasma on Wayland, kernel 7.1.3, an AMD
Radeon RX 7800 XT (`amdgpu`/RadeonSI), and Mesa 26.1.7. The installed Flatpak
Chrome 151.0.7922.173 uses Mesa 26.1.6 from its runtime. The artifact occurs
with native Wayland and GPU compositing enabled, but it does not occur when
the same Chrome build and AMD/Mesa stack use X11. A manual run of the installed
Flatpak Chrome with `--ozone-platform=x11` independently confirmed the clean
X11 result.

The failure is not specific to the AMD driver. It still occurs in a headed
Wayland session when ANGLE is forced to SwiftShader while Chrome keeps GPU
compositing enabled. Conversely, it disappears when GPU compositing is
disabled. The best-supported scope is therefore Chrome's headed
Ozone/Wayland GPU-compositing path. Astro's named snapshots trigger the faulty
path, but the evidence points to Chrome's presentation/composition layer as
the source of the white pixels.

One captured sequence showed three distinct failures in the same transition:

- a page-wide white strip extending down from the viewport's top edge;
- a separate white rectangle matching the page-title snapshot bounds; and
- the remainder of the outgoing page temporarily composited as pale grey.

The top navigation continued to render correctly above all three areas. This
is consistent with a stale or uninitialized View Transition surface, rather
than a white element being inserted into the document.

Windows 11 Chrome did not reproduce the artifact. That is consistent with the
diagnosis because Windows uses a different ANGLE and display-compositor path.
The mainline production workaround in commit `093d23e` bypasses Chrome's
native View Transition API so Astro takes its DOM/CSS fallback. The workaround
is intentionally independent of any page-content timing or CSS snapshot
adjustment.

This note records the evidence, environment comparison, and inspection
procedure. It does not identify the exact upstream Chromium code defect.

## Environment isolation matrix

The automated comparison exercised the same route sequence and scanned every
captured compositor frame. An artifact frame was defined as one where at least
10% of the 720 x 330 area below the navigation was near-white. Normal page
titles stayed below 8% in clean runs; failed frames reached approximately 91%.

| Chrome configuration | Transitions | Captured frames | Artifact frames | Result |
| --- | ---: | ---: | ---: | --- |
| Default headed session, Wayland selected automatically, AMD/Mesa | 48 | 1,310 | 183 | Reproduced |
| Explicit `--ozone-platform=wayland`, AMD/Mesa | 32 | 902 | 133 | Reproduced |
| Wayland, ANGLE forced to SwiftShader, GPU compositing enabled | 48 | 417 | 259 | Reproduced |
| Wayland, `--disable-gpu` | 48 | 733 | 0 | Clean |
| Explicit `--ozone-platform=x11`, same AMD/Mesa GPU path | 80 | 2,265 | 0 | Clean |
| Headless SwiftShader, GPU compositing disabled | 48 | 1,270 | 0 | Clean |

This matrix rules out several broader explanations:

- It is not an AMD-only failure because the Wayland/SwiftShader run fails.
- It is not caused by hardware acceleration alone because X11 remains clean
  with the same AMD GPU and Mesa driver.
- It is not caused by Wayland alone because disabling Chrome's GPU compositor
  on Wayland remains clean.
- It is not a general Astro DOM-swap flash because the failed pixels follow
  independent native View Transition surface boundaries while the persistent
  navigation remains correctly composited.

The necessary combination in this environment is a headed Chrome session,
the Ozone Wayland backend, GPU compositing, and the site's native View
Transition snapshot arrangement.

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
2. Open the local site in Chrome on a Wayland desktop with hardware
   acceleration enabled. Confirm `Ozone platform: wayland` and hardware
   compositing in `chrome://gpu`.
3. Select the dark theme so a white or pale surface is immediately visible.
4. Use a desktop viewport near 1440 x 1000. If DevTools is open, undock it so
   it does not continually change the page viewport.
5. Alternate between Software and Photography, or between Home and About.
   Ten to twenty transitions are usually enough to catch an occurrence.

Do not enable `prefers-reduced-motion` for this test. The site intentionally
cancels the relevant animations under that preference, which hides the
problem rather than exercising it.

## Confirm the Wayland boundary

Fully quit Chrome so an existing browser process cannot retain its original
flags, then launch the Flatpak build through X11:

```bash
flatpak run com.google.Chrome --ozone-platform=x11
```

Open `chrome://gpu` and confirm that the Ozone platform is X11. Repeat the
normal-speed route sequence. The extended validation completed 80 transitions
and captured 2,265 frames without a white artifact while retaining hardware
acceleration on the same AMD GPU.

As a second diagnostic, turn off **Use graphics acceleration when available**
in Chrome's system settings, restart Chrome, and repeat the sequence under
Wayland. This was also clean. Re-enable acceleration after the experiment;
disabling it globally has a wider performance cost than using X11 for this
specific comparison.

Application code cannot reliably detect whether Linux Chrome is using Wayland
or X11. If the native transition is conditionally bypassed, desktop Linux
Chrome is therefore the narrowest dependable runtime scope. Scoping the
workaround to Fedora or AMD would not match the evidence, while applying it to
all Chrome installations unnecessarily removes native transitions from the
tested clean Windows configuration.

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

For Linux compositor isolation, add these launch conditions to the comparison:

| Launch condition | Diagnostic value |
| --- | --- |
| `--ozone-platform=wayland` | Exercises the affected native Wayland path explicitly. |
| `--ozone-platform=x11` | Keeps hardware acceleration while changing the window-system path. |
| `--disable-gpu` | Tests whether Chrome's GPU compositor is required. |
| `--use-angle=swiftshader --enable-unsafe-swiftshader` | Replaces AMD/Mesa rendering while retaining headed GPU composition. |

These DevTools experiments should remain temporary until one property is shown
to control the artifact consistently. A production code change should then be
verified across Chrome, Firefox, reduced motion, both themes, and the full
route relationship matrix.

## Related upstream reports

No public ticket found so far exactly combines same-document View Transitions,
Astro, and Chrome's Ozone Wayland backend. These Chromium reports cover the
closest failure classes:

- [Chromium issue 327208227](https://issues.chromium.org/issues/327208227/resources),
  **Flicker during ViewTransition**, is assigned to Chromium's GPU and
  compositing components. Its detailed description is not publicly indexed.
- [Chromium issue 502616235](https://issues.chromium.org/issues/502616235),
  **MPA Cross Document View Transitions are flickering when navigating and
  sometimes rendering white**, reports random white output that disappears
  when DevTools is open. It was fixed for the cross-document path and was
  reported on macOS, so it is a close visual match but not this same-document
  Wayland case.
- [Chromium issue 485440171](https://issues.chromium.org/issues/485440171),
  **Google Meet filters cause the camera feed to turn white unless
  `--disable-gpu-compositing` is used**, reports white output on Wayland that
  did not occur on X11. Its NVIDIA environment supports the conclusion that
  this broader Chrome/Wayland surface failure class is not AMD-specific.
- [Chromium issue 514710688](https://issues.chromium.org/issues/514710688)
  records a different GPU workload that works on Windows 11 but stalls on
  Chrome's Linux Wayland presentation path. It reinforces the importance of
  separating application behavior from the platform compositor backend.
- [Chromium issue 542796760](https://issues.chromium.org/issues/542796760),
  **`::backdrop` not painted during a view transition when the root is clipped
  and page is scrolled**, demonstrates a current Chrome 151 View Transition
  case where animations and computed styles advance correctly while the
  compositor does not paint the expected viewport-anchored pixels.

A new Chromium report should reference those issues and attach the Wayland,
X11, SwiftShader, and disabled-GPU results. That matrix is more useful than an
AMD-only report because it identifies the failing presentation path without
assuming a vendor-driver cause.
