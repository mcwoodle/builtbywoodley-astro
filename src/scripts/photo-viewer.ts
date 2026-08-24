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

  function render(index: number) {
    const dialog = panel();
    const frame = frames[index];
    if (!dialog || !frame) return;

    openIndex = index;

    const image = el<HTMLImageElement>("[data-photo-image]");
    if (image) {
      image.width = frame.width;
      image.height = frame.height;
      image.src = frame.src;
      image.srcset = frame.srcset;
      image.sizes = frame.sizes;
      image.alt = frame.alt;
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

      if (target.closest("[data-photo-close]") || target.matches(".photo-viewer")) {
        event.preventDefault();
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
