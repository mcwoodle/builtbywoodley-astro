let lastScrollY = Math.max(window.scrollY, 0);
let navOffset = 0;
let animationFrame = 0;

const currentNav = () => document.querySelector<HTMLElement>('.top-nav');

function setNavOffset(nav: HTMLElement, offset: number) {
  navOffset = offset;
  nav.style.setProperty('--nav-scroll-offset', `${offset}px`);
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
window.addEventListener('resize', resetNav);
document.addEventListener('astro:page-load', resetNav);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  resetNav();
});

resetNav();
