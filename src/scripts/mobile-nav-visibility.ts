const mobileViewport = window.matchMedia('(max-width: 720px)');

let lastScrollY = Math.max(window.scrollY, 0);
let navOffset = 0;
let animationFrame = 0;

const currentNav = () => document.querySelector<HTMLElement>('.top-nav');

function setNavOffset(nav: HTMLElement, offset: number) {
  navOffset = offset;
  nav.style.setProperty('--mobile-nav-offset', `${offset}px`);
}

function resetNav() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastScrollY = Math.max(window.scrollY, 0);
  const nav = currentNav();
  if (nav) setNavOffset(nav, 0);
}

function updateNavVisibility() {
  animationFrame = 0;

  const nav = currentNav();
  const scrollY = Math.max(window.scrollY, 0);
  const delta = scrollY - lastScrollY;
  lastScrollY = scrollY;

  if (!nav) return;

  if (!mobileViewport.matches || scrollY <= 0) {
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
document.addEventListener('astro:page-load', resetNav);
document.addEventListener('focusin', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.top-nav')) return;
  resetNav();
});

if (typeof mobileViewport.addEventListener === 'function') {
  mobileViewport.addEventListener('change', resetNav);
}
else {
  mobileViewport.addListener(resetNav);
}

resetNav();
