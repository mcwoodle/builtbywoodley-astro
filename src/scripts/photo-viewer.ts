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
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartAt = 0;
  let dragOffset = 0;
  let dragMoved = false;
  /** A drag ends in a click the panel must not read as "dismiss". */
  let swallowClick = false;
  /** Where the incoming picture should slide in from, set by the outgoing one. */
  let enterFrom = 0;

  const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const el = <T extends Element>(selector: string) =>
    document.querySelector<T>(selector);

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

  function image() {
    return el<HTMLImageElement>("[data-photo-image]");
  }

  function paintDrag(offset: number) {
    const picture = image();
    if (!picture) return;
    picture.style.transform = `translate3d(0, ${offset}px, 0)`;
    // Fades out as it travels, so a swipe reads as the frame leaving.
    picture.style.opacity = String(Math.max(0, 1 - Math.abs(offset) / 340));
  }

  function clearDrag() {
    const picture = image();
    if (!picture) return;
    picture.style.transform = "";
    picture.style.opacity = "";
  }

  /** Animate the picture to a resting place and leave it there. */
  function glideTo(offset: number, opacity: number, duration: number) {
    const picture = image();
    if (!picture) return Promise.resolve();

    const settle = () => {
      picture.style.transform = `translate3d(0, ${offset}px, 0)`;
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
        { transform: `translate3d(0, ${offset}px, 0)`, opacity: String(opacity) },
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

  function endDrag(cancelled: boolean) {
    if (!dragging) return;
    dragging = false;

    const travelled = Math.abs(dragOffset);
    const speed = travelled / Math.max(1, performance.now() - dragStartAt);
    const carried =
      !cancelled &&
      (travelled > SWIPE_DISTANCE ||
        (travelled > SWIPE_FLICK_DISTANCE && speed > SWIPE_FLICK_SPEED));

    if (!carried) {
      void glideTo(0, 1, 280).then(clearDrag);
      return;
    }

    // Swiping up carries the frame away and brings the next one up behind it,
    // the way a stack of prints is dealt through.
    const direction = dragOffset < 0 ? 1 : -1;
    const exit = direction === 1 ? -window.innerHeight : window.innerHeight;
    enterFrom = -exit;
    void glideTo(exit, 0, 190).then(() => step(direction));
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

    dragOffset = deltaY;
    paintDrag(deltaY);
  }

  function render(index: number) {
    const dialog = panel();
    const frame = frames[index];
    if (!dialog || !frame) return;

    openIndex = index;

    const picture = image();
    if (picture) {
      picture.width = frame.width;
      picture.height = frame.height;
      picture.src = frame.src;
      picture.srcset = frame.srcset;
      picture.sizes = frame.sizes;
      picture.alt = frame.alt;

      if (enterFrom) {
        // Start it off-screen and bring it in once it has actually decoded,
        // otherwise the old frame is what slides.
        const from = enterFrom;
        enterFrom = 0;
        paintDrag(from);
        const arrive = () => {
          requestAnimationFrame(() => void glideTo(0, 1, 300).then(clearDrag));
        };
        if (picture.complete) arrive();
        else picture.addEventListener("load", arrive, { once: true });
      } else {
        clearDrag();
      }
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

    lockScroll();
    if (!dialog.open) dialog.showModal();
  }

  function close() {
    const dialog = panel();
    if (dialog?.open) dialog.close();
    openIndex = -1;
    pushedByGrid = false;
    dragging = false;
    enterFrom = 0;
    clearDrag();
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
  function step(delta: number) {
    if (openIndex < 0 || frames.length < 2) return;
    const next = (openIndex + delta + frames.length) % frames.length;
    location.replace(`#${encodeURIComponent(frames[next].anchor)}`);
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
        step(Number(stepper.dataset.photoStep));
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
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  });

  // Astro's router settles a same-page hash link with pushState and a synthetic
  // popstate, which means no hashchange fires for a tile click — both events are
  // needed to catch every way the hash can change.
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true });
  document.addEventListener("touchend", () => endDrag(false));
  document.addEventListener("touchcancel", () => endDrag(true));

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
