// Drives the photography viewer panel.
//
// The open photograph is part of the URL (#<anchor>), so the panel is a place
// rather than a piece of component state: Back closes it, Forward reopens it,
// and a link to one frame works. Everything here reads from location.hash and
// renders to match, which also means the panel survives however the hash was
// reached — a tile click, a shared link, or a history traversal.

type Frame = {
  anchor: string;
  alt: string;
  title: string;
  note: string;
  stamp: string;
  datetime: string;
  place: string;
  src: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
};

/** Where an incoming photograph slides in from, along which axis. */
type Entrance = { axis: "x" | "y"; offset: number } | "open";

// Astro re-runs page scripts on some ClientRouter navigations; the document
// level listeners below must only ever be attached once.
const bound = "__photoViewerBound";
if (!(bound in window)) {
  (window as Record<string, unknown>)[bound] = true;
  start();
}

function start() {
  let frames: Frame[] = [];
  let openIndex = -1;
  /** The frame the panel is currently showing, so a re-render does not restage. */
  let shownAnchor = "";
  /** Invalidates a decode that resolves after the reader has moved on. */
  let revealToken = 0;
  // Whether the panel's history entry was pushed by a click in the grid. A
  // deep link has no entry of its own to go back to.
  let pushedByGrid = false;
  let lockedScrollY = 0;
  let scrollLocked = false;

  // Swipe state. A drag moves the picture under the finger; letting go either
  // carries it off and advances, or springs it back.
  const SWIPE_DISTANCE = 64;
  const SWIPE_FLICK_DISTANCE = 22;
  const SWIPE_FLICK_SPEED = 0.45; // px per ms
  /** How far a drag travels once there is nothing further to reach. */
  const EDGE_RESISTANCE = 0.32;
  const ENTER_SHIFT = 96;
  const STEP_EXIT_SHIFT = 72;

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartAt = 0;
  let dragOffset = 0;
  let dragMoved = false;
  /** A drag ends in a click the panel must not read as "dismiss". */
  let swallowClick = false;
  /** Set by an outgoing frame, read by the incoming one. */
  let pendingEntrance: Entrance | null = null;
  /** A frame is on its way out; ignore steps until it has gone. */
  let stepping = false;

  const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  /** Stepping follows the axis its controls sit on: sideways, or up and down. */
  const stepAxis = (): "x" | "y" =>
    window.matchMedia?.("(max-width: 760px)").matches ? "y" : "x";

  const el = <T extends Element>(selector: string) =>
    document.querySelector<T>(selector);

  const image = () => el<HTMLImageElement>("[data-photo-image]");

  function panel() {
    const dialog = el<HTMLDialogElement>(".photo-viewer");
    // `cancel` (the Escape key) does not bubble, so it is bound per element.
    if (dialog && !dialog.dataset.photoBound) {
      dialog.dataset.photoBound = "true";
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        requestClose();
      });
    }
    return dialog;
  }

  function readFrames() {
    const source = el("[data-photo-frames]");
    try {
      frames = source ? (JSON.parse(source.textContent || "[]") as Frame[]) : [];
    } catch {
      frames = [];
    }
  }

  function hashIndex() {
    const anchor = decodeURIComponent(location.hash.slice(1));
    if (!anchor) return -1;
    return frames.findIndex((frame) => frame.anchor === anchor);
  }

  /** The archive has two ends. Walking off either one is not a step. */
  function canStep(direction: number) {
    const next = openIndex + direction;
    return openIndex >= 0 && next >= 0 && next < frames.length;
  }

  // Astro's router scrolls the document when it handles the hash navigation, so
  // the page is pinned before that happens and released on the way out.
  function lockScroll() {
    if (scrollLocked) return;
    scrollLocked = true;
    lockedScrollY = window.scrollY;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add("is-photo-viewing");
  }

  function releaseScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.body.classList.remove("is-photo-viewing");
    document.body.style.top = "";
    window.scrollTo(0, lockedScrollY);
  }

  const shift = (axis: "x" | "y", offset: number) =>
    `translate3d(${axis === "x" ? offset : 0}px, ${axis === "y" ? offset : 0}px, 0)`;

  function paintDrag(offset: number) {
    const picture = image();
    if (!picture) return;
    picture.style.transform = shift("y", offset);
    // Fades out as it travels, so a swipe reads as the frame leaving.
    picture.style.opacity = String(Math.max(0, 1 - Math.abs(offset) / 340));
  }

  function restPicture() {
    const picture = image();
    if (!picture) return;
    picture.style.transform = "";
    picture.style.opacity = "";
  }

  /** Animate the picture to a resting place and leave it there. */
  function glideTo(transform: string, opacity: number, duration: number) {
    const picture = image();
    if (!picture) return Promise.resolve();

    const settle = () => {
      picture.style.transform = transform;
      picture.style.opacity = String(opacity);
    };

    if (reducedMotion() || !picture.animate) {
      settle();
      return Promise.resolve();
    }

    const motion = picture.animate(
      [
        {
          transform: picture.style.transform || "translate3d(0, 0, 0)",
          opacity: picture.style.opacity || "1",
        },
        { transform, opacity: String(opacity) },
      ],
      { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    );

    return motion.finished
      .catch(() => {})
      .then(() => {
        settle();
        motion.cancel();
      });
  }

  /**
   * Stage the incoming photograph out of sight, then bring it in — but only
   * once the browser can actually paint it. One <img> serves every frame, so
   * revealing it before the new bytes have decoded shows the last one instead.
   */
  function revealPicture(from: Entrance) {
    const picture = image();
    if (!picture) return;

    const token = ++revealToken;
    const opening = from === "open";
    const start = opening
      ? "translate3d(0, 10px, 0) scale(0.986)"
      : shift(from.axis, from.offset);

    picture.style.transform = start;
    picture.style.opacity = "0";

    const arrive = () => {
      if (token !== revealToken) return;
      if (reducedMotion() || !picture.animate) {
        restPicture();
        return;
      }
      const motion = picture.animate(
        [
          { transform: start, opacity: 0 },
          { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
        ],
        {
          duration: opening ? 400 : 330,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );
      void motion.finished
        .catch(() => {})
        .then(() => {
          if (token !== revealToken) return;
          restPicture();
          motion.cancel();
        });
    };

    const decoded = picture.decode
      ? picture.decode().catch(() => {})
      : new Promise<void>((resolve) => {
          if (picture.complete) resolve();
          else picture.addEventListener("load", () => resolve(), { once: true });
        });

    void decoded.then(() => requestAnimationFrame(arrive));
  }

  /** Switch off whichever control has nothing left to reach. */
  function updateSteps(index: number) {
    const previous = el<HTMLButtonElement>('[data-photo-step="-1"]');
    const next = el<HTMLButtonElement>('[data-photo-step="1"]');
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index >= frames.length - 1;

    // Keep focus in the panel when the control under it switches off.
    const active = document.activeElement;
    if (previous?.disabled && active === previous) next?.focus();
    else if (next?.disabled && active === next) previous?.focus();
  }

  function render(index: number) {
    const dialog = panel();
    const frame = frames[index];
    if (!dialog || !frame) return;

    const changed = shownAnchor !== frame.anchor;
    const opening = !dialog.open;
    openIndex = index;
    shownAnchor = frame.anchor;

    const picture = image();
    if (picture && changed) {
      picture.width = frame.width;
      picture.height = frame.height;
      picture.src = frame.src;
      picture.srcset = frame.srcset;
      picture.sizes = frame.sizes;
      picture.alt = frame.alt;
    }

    const title = el("[data-photo-title]");
    if (title) title.textContent = frame.title;

    const note = el<HTMLElement>("[data-photo-note]");
    if (note) {
      note.textContent = frame.note;
      note.hidden = !frame.note;
    }

    const date = el<HTMLTimeElement>("[data-photo-date]");
    if (date) {
      date.textContent = frame.stamp;
      date.dateTime = frame.datetime;
    }

    const place = el("[data-photo-place]");
    if (place) place.textContent = frame.place;

    const count = el("[data-photo-count]");
    if (count) count.textContent = `${index + 1} / ${frames.length}`;

    updateSteps(index);

    lockScroll();
    if (opening) dialog.showModal();

    const entrance = pendingEntrance ?? "open";
    pendingEntrance = null;
    if (changed || opening) revealPicture(entrance);
  }

  function close() {
    const dialog = panel();
    if (dialog?.open) dialog.close();
    openIndex = -1;
    shownAnchor = "";
    revealToken += 1;
    pushedByGrid = false;
    pendingEntrance = null;
    dragging = false;
    stepping = false;
    restPicture();
    releaseScroll();
  }

  /** Render whatever the URL currently asks for. */
  function sync() {
    if (!el(".photo-viewer")) return;
    const index = hashIndex();
    if (index >= 0) render(index);
    else close();
  }

  function requestClose() {
    if (pushedByGrid) {
      history.back();
      return;
    }
    // Arrived here by a shared link: drop the hash without stranding the
    // visitor on whatever page they were on before this one.
    if (location.hash) {
      history.replaceState(history.state, "", location.pathname + location.search);
    }
    close();
  }

  /** Move to another frame without adding to history, so Back still closes. */
  function step(direction: number) {
    if (!canStep(direction)) return;
    location.replace(`#${encodeURIComponent(frames[openIndex + direction].anchor)}`);
  }

  /** Send the current frame out along the control axis and bring the next in. */
  function advance(direction: number) {
    if (stepping || !canStep(direction)) return;
    const axis = stepAxis();
    pendingEntrance = { axis, offset: direction * ENTER_SHIFT };
    stepping = true;
    void glideTo(shift(axis, -direction * STEP_EXIT_SHIFT), 0, 190).then(() => {
      stepping = false;
      step(direction);
    });
  }

  function endDrag(cancelled: boolean) {
    if (!dragging) return;
    dragging = false;

    const direction = dragOffset < 0 ? 1 : -1;
    const travelled = Math.abs(dragOffset);
    const speed = travelled / Math.max(1, performance.now() - dragStartAt);
    const carried =
      !cancelled &&
      canStep(direction) &&
      (travelled > SWIPE_DISTANCE ||
        (travelled > SWIPE_FLICK_DISTANCE && speed > SWIPE_FLICK_SPEED));

    if (!carried) {
      void glideTo("translate3d(0, 0, 0)", 1, 280).then(restPicture);
      return;
    }

    // Swiping up carries the frame away and brings the next one up behind it,
    // the way a stack of prints is dealt through.
    pendingEntrance = { axis: "y", offset: direction * ENTER_SHIFT };
    const exit = direction === 1 ? -window.innerHeight : window.innerHeight;
    void glideTo(shift("y", exit), 0, 200).then(() => step(direction));
  }

  function onTouchStart(event: TouchEvent) {
    if (openIndex < 0 || event.touches.length !== 1) return;
    const target = event.target instanceof Element ? event.target : null;
    const stage = el(".photo-viewer-stage");
    if (!target || !stage?.contains(target) || target.closest("button")) return;

    dragging = true;
    dragMoved = false;
    swallowClick = false;
    dragOffset = 0;
    dragStartAt = performance.now();
    dragStartX = event.touches[0].clientX;
    dragStartY = event.touches[0].clientY;
  }

  function onTouchMove(event: TouchEvent) {
    if (!dragging || event.touches.length !== 1) return;

    const deltaY = event.touches[0].clientY - dragStartY;
    const deltaX = event.touches[0].clientX - dragStartX;

    // A sideways gesture is not ours; hand it back rather than fighting it.
    if (!dragMoved && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 12) {
      endDrag(true);
      return;
    }

    if (Math.abs(deltaY) > 6) {
      dragMoved = true;
      swallowClick = true;
    }

    // Past the last frame the picture still gives a little, so the end of the
    // archive is something you feel rather than something that ignores you.
    const direction = deltaY < 0 ? 1 : -1;
    dragOffset = canStep(direction) ? deltaY : deltaY * EDGE_RESISTANCE;
    paintDrag(dragOffset);
  }

  function isPlainClick(event: MouseEvent) {
    return (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  // Capture phase: the scroll lock has to land before Astro's router handles
  // the hash navigation and scrolls the document.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest("[data-photo-open]") && isPlainClick(event)) {
        pushedByGrid = true;
        lockScroll();
        return;
      }

      const stepper = target.closest<HTMLElement>("[data-photo-step]");
      if (stepper) {
        event.preventDefault();
        advance(Number(stepper.dataset.photoStep));
        return;
      }

      if (target.closest("[data-photo-close]")) {
        event.preventDefault();
        requestClose();
        return;
      }

      // Anywhere else inside the panel dismisses it — except the click that
      // trails a swipe, which was a gesture rather than a tap.
      const dialog = panel();
      if (dialog?.open && (target === dialog || dialog.contains(target))) {
        event.preventDefault();
        if (swallowClick) {
          swallowClick = false;
          return;
        }
        requestClose();
      }
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (openIndex < 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      advance(-1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      advance(1);
    }
  });

  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true });
  document.addEventListener("touchend", () => endDrag(false));
  document.addEventListener("touchcancel", () => endDrag(true));

  // Astro's router settles a same-page hash link with pushState and a synthetic
  // popstate, which means no hashchange fires for a tile click — both events are
  // needed to catch every way the hash can change.
  window.addEventListener("hashchange", sync);
  window.addEventListener("popstate", sync);
  document.addEventListener("astro:before-swap", close);
  document.addEventListener("astro:page-load", () => {
    readFrames();
    pushedByGrid = false;
    sync();
  });

  readFrames();
  sync();
}
