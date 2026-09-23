# Chromium bug report draft: Wayland View Transition white surfaces

Status: ready to file

Last verified: 2026-08-27

This is a copy-ready draft for the
[Chromium issue tracker](https://issues.chromium.org/issues/new). Upload the
screenshot listed under **Attachments** when filing. The report deliberately
does not identify Astro, AMD, or Fedora as the root cause: the comparison
results isolate the failure to Chrome's headed Ozone/Wayland GPU-compositing
path, while the exact faulty Chromium subsystem remains to be determined.

## Suggested tracker fields

**Title**

> Ozone/Wayland GPU compositing intermittently presents same-document View
> Transition snapshot surfaces as white

**Component**

Start with `Blink>ViewTransitions`. The Wayland/X11 and compositor-on/off
split suggests that triage may belong in `Internals>Compositing`,
`Internals>GPU`, or `UI>Ozone>Wayland`.

**Type / severity**

Bug, visual rendering failure. Suggested severity: S3. The page remains
usable, but the defect produces a conspicuous flash and forces sites to bypass
the native API for affected Chrome sessions.

**Regression**

Unknown. The earliest build tested is Chrome for Testing 151.0.7922.34. The
failure is still present in Chrome for Testing Canary 154.0.8026.0. No
known-good Wayland Chrome build has been identified.

## Description to paste into the report

### Summary

In a headed Chrome session using Ozone/Wayland and GPU compositing, a
same-document View Transition intermittently presents one or more snapshot
surfaces as white or pale grey. A white surface can extend from the top of the
viewport to the page-title area, and a second rectangle can match the named
page-title snapshot. The surfaces then fade away with the transition. The
fixed, separately named top-navigation snapshot continues to render correctly
above the failed surfaces.

The problem reproduces in the current Chrome for Testing Canary
154.0.8026.0. With the same Canary binary, site, route sequence, viewport, GPU,
and driver, an explicit Wayland run captured 27 bad frames out of 931, while
an explicit X11 run captured 0 out of 952. It also reproduces under Wayland
when ANGLE is forced to SwiftShader but GPU compositing remains enabled, and
it disappears under Wayland with `--disable-gpu`. This points to Chrome's
headed Ozone/Wayland GPU-compositing or presentation path rather than an AMD
driver-specific fault.

The page uses Astro's client router to invoke the standard
`document.startViewTransition()` same-document API. The artifact follows
native View Transition snapshot boundaries; no white DOM element is added.
The application-level workaround is to hide `document.startViewTransition`
from the router on desktop Linux Chrome, allowing a DOM/CSS fallback instead.

### Reproduction URL and source

- Live native-transition preview:
  <https://eedc13ba-builtbywoodley.woodley-matt.workers.dev>
- Exact source branch used by the preview:
  <https://github.com/mcwoodle/builtbywoodley-astro/tree/docs/chrome-view-transition-artifact>
- Native router entry point (there is no Chrome workaround on this branch):
  <https://github.com/mcwoodle/builtbywoodley-astro/blob/docs/chrome-view-transition-artifact/src/components/NavigationTransitionHead.astro>
- Transition CSS:
  <https://github.com/mcwoodle/builtbywoodley-astro/blob/docs/chrome-view-transition-artifact/src/styles/view-transitions.css>

### Steps to reproduce

1. On a Linux Wayland desktop, fully quit Chrome so that an existing process
   cannot retain a different Ozone backend.
2. Launch Chrome for Testing Canary 154.0.8026.0 with a fresh profile and the
   Wayland backend:

   ```bash
   chrome --user-data-dir=/tmp/chrome-vt-wayland \
     --ozone-platform=wayland
   ```

3. Open the live reproduction URL above at a desktop viewport near
   1440 x 1000. Hardware acceleration must be enabled and reduced motion must
   be disabled.
4. Select the site's dark theme. Alternatively, run the following in the
   Console and reload so that a white surface is easy to distinguish:

   ```js
   localStorage.setItem('theme', 'dark'); location.reload();
   ```

5. Confirm in `chrome://gpu` that the Ozone platform is Wayland and
   compositing is hardware accelerated.
6. Repeatedly click these top-navigation destinations:
   Software, Photography, Home, About, Software, Home, Photography, About.
   Repeat the sequence two to four times. Because the failure is intermittent,
   10–30 transitions may be required.
7. Watch the area between the top edge of the viewport and the page heading
   during each transition.
8. For the control, fully quit Canary and launch the same binary with a second
   fresh profile and `--ozone-platform=x11`. Repeat the identical sequence.

### Expected result

The old and new dark page snapshots should translate and fade smoothly. The
fixed navigation should remain stationary. No white or pale surface should be
presented.

### Actual result

Intermittently, a page-wide white band or surface appears from the top of the
viewport down to the page-title area. A separate white rectangle may cover the
named page-title snapshot, while other outgoing content may become pale grey.
The incorrectly presented surfaces fade with the View Transition. The
separately named top-navigation surface remains correctly rendered on top.

The attached screenshot is a compositor frame from Canary 154.0.8026.0 under
explicit Wayland. It shows the navigation rendered correctly while the area
below it is presented as white.

### Environment

- OS: Fedora Linux 44 KDE Plasma Desktop Edition, Wayland session
- Kernel: 7.1.3-200.fc44.x86_64
- Browser: Chrome for Testing Canary 154.0.8026.0, revision 1686278
- GPU: AMD Radeon RX 7800 XT / Navi 32 (`1002:747e`)
- Kernel driver: `amdgpu`
- Mesa: 26.1.7, RadeonSI/ACO
- ANGLE renderer: OpenGL ES 3.2 over Mesa/RadeonSI
- `chrome://gpu`: GPU compositing enabled; rasterization and OpenGL enabled;
  display type `ANGLE_OPENGL`
- Viewport: 1440 x 1000, device scale factor 1, dark color scheme

The initial reproduction also occurred in Chrome for Testing 151.0.7922.34
and installed Flatpak Chrome 151.0.7922.173. A Windows 11 Chrome test did not
reproduce it.

### Reproduction and isolation results

Every compositor frame was captured through the Chrome DevTools Protocol. A
bad frame was classified when near-white pixels covered at least 10% of a
720 x 330 crop below the navigation. Clean titles remained below 8%; the
failed Canary Wayland run reached approximately 91%.

| Chrome configuration | Transitions | Frames | Bad frames | Result |
| --- | ---: | ---: | ---: | --- |
| Canary 154.0.8026.0, explicit Wayland, AMD/Mesa | 32 | 931 | 27 | Reproduced |
| Canary 154.0.8026.0, explicit X11, same AMD/Mesa | 32 | 952 | 0 | Clean |
| Chrome 151, default headed Wayland, AMD/Mesa | 48 | 1,310 | 183 | Reproduced |
| Chrome 151, explicit Wayland, AMD/Mesa | 32 | 902 | 133 | Reproduced |
| Chrome 151, Wayland, ANGLE SwiftShader, GPU compositing enabled | 48 | 417 | 259 | Reproduced |
| Chrome 151, Wayland, `--disable-gpu` | 48 | 733 | 0 | Clean |
| Chrome 151, explicit X11, AMD/Mesa | 80 | 2,265 | 0 | Clean |
| Chrome 151, headless SwiftShader, GPU compositing disabled | 48 | 1,270 | 0 | Clean |

The same installed Flatpak Chrome was also tested manually with
`--ozone-platform=x11`; the issue disappeared while hardware acceleration
remained enabled.

### Additional diagnostics

- A fresh automated browser context was used, so extensions were not loaded.
- The failure was captured through CDP screencasting without DevTools changing
  the page viewport.
- Slowing View Transition animations to 10% through
  `Animation.setPlaybackRate` makes a failed surface remain visible for
  inspection; it does not turn the page's DOM background white.
- The affected transition has independently named `root`, `page-backdrop`,
  `page-title`, and `top-nav` snapshots. The root and title surfaces can fail
  while `top-nav` remains correct.
- A standalone same-document View Transition reduction did not reproduce in a
  32-transition Canary run. The live source above is therefore the smallest
  verified reproduction currently available; no claim is made that Astro is
  required.

### Related Chromium issues

- [Issue 327208227: Flicker during ViewTransition](https://issues.chromium.org/issues/327208227)
  is assigned to GPU/compositing components, but its public description is not
  sufficient to confirm whether this is a duplicate.
- [Issue 502616235: MPA cross-document View Transitions flicker or render white](https://issues.chromium.org/issues/502616235)
  is a close visual match, but it concerns cross-document transitions on
  macOS. Its
  [fix landed at Chromium main position 1654284](https://chromium.googlesource.com/chromium/src/+/095dd073f0988eaa6e0ea743a456218d0e586d05),
  while this same-document Wayland failure remains in Canary revision 1686278.
- [Issue 485440171: Wayland output turns white unless GPU compositing is disabled](https://issues.chromium.org/issues/485440171)
  is a different workload, but reports the same Wayland/X11 and
  GPU-compositor boundary on NVIDIA hardware.

### User impact

The failure creates a conspicuous white flash on dark sites and is
intermittent enough to escape ordinary testing. The current site workaround
disables native View Transitions for desktop Linux Chrome because Web content
cannot reliably determine whether Chrome selected its Wayland or X11 Ozone
backend.

## Attachments

Upload this file with the report:

- [Chrome Canary Wayland white-surface frame](./assets/chrome-canary-wayland-white-surface.png)
  — PNG, 1440 x 1000, captured from Chrome for Testing 154.0.8026.0 with
  `--ozone-platform=wayland`.

If Chromium triage requests more data, capture and attach the full
`chrome://gpu` report and a Performance trace with screenshots from the same
Wayland session. The detailed local investigation and instructions for
pausing the animation are in
[Chrome View Transition white-rectangle artifact](./chrome-view-transition-white-rectangle.md).

## Filing checklist

- Paste the suggested title and description into a new Chromium issue.
- Select `Blink>ViewTransitions` if the form asks for a component.
- Upload `docs/assets/chrome-canary-wayland-white-surface.png`.
- Mark the report as reproducible in Canary 154.0.8026.0.
- Do not mark it as an AMD-only or Fedora-only issue; SwiftShader reproduces
  it and X11 on the same host is clean.
- Add the filed issue URL to this document and the investigation note.
