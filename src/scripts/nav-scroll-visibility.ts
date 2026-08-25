let lastScrollY = Math.max(window.scrollY, 0);
let lastWidth = window.innerWidth;
let navOffset = 0;
let animationFrame = 0;
// A phone's address bar sliding in or out resizes the window and shifts the
// page under the reader. That is the browser moving, not the reader scrolling,
// so the jump it reports is dropped rather than driving the nav.
let ignoreNextDelta = false;

const currentNav = () => document.querySelector<HTMLElement>('.top-nav');

function setNavOffset(nav: HTMLElement, offset: number) {
  navOffset = offset;
  nav.style.setProperty('--nav-scroll-offset', `${offset}px`);
  // Also on the root, so anything perched on the nav — the AI-slop robot hangs
  // from its underside — can ride up and down with it.
  document.documentElement.style.setProperty('--nav-scroll-offset', `${offset}px`);
}

function resetNav() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastScrollY = Math.max(window.scrollY, 0);
  const nav = currentNav();
  if (nav) setNavOffset(nav, 0);
}

/** Take the page where it now is as the new baseline, leaving the nav be. */
function rebaseline() {
  lastScrollY = Math.max(window.scrollY, 0);
  ignoreNextDelta = true;
}

function updateNavVisibility() {
  animationFrame = 0;

  const nav = currentNav();
  const scrollY = Math.max(window.scrollY, 0);
  const delta = scrollY - lastScrollY;
  lastScrollY = scrollY;

  if (!nav) return;

  if (ignoreNextDelta) {
    ignoreNextDelta = false;
    return;
  }

  if (scrollY <= 0) {
    setNavOffset(nav, 0);
    return;
  }

  const hiddenOffset = -(nav.offsetHeight + 10);
  setNavOffset(nav, Math.min(0, Math.max(hiddenOffset, navOffset - delta)));
}

function scheduleVisibilityUpdate() {
  if (animationFrame) return;
  animationFrame = requestAnimationFrame(updateNavVisibility);
}

window.addEventListener('scroll', scheduleVisibilityUpdate, { passive: true });

window.addEventListener('resize', () => {
  // A real layout change — a rotation, a window dragged to a new size — is
  // worth starting over for.
  if (window.innerWidth !== lastWidth) {
    lastWidth = window.innerWidth;
    resetNav();
    return;
  }

  // Height alone changed, which on a phone means the browser's own chrome
  // moved. Resetting here is what made the nav pop into view mid-scroll.
  rebaseline();
});

// The precise signal for that chrome, where the browser offers it.
window.visualViewport?.addEventListener('resize', () => {
  if (window.innerWidth !== lastWidth) return;
  rebaseline();
});

document.addEventListener('astro:page-load', resetNav);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  resetNav();
});

resetNav();
