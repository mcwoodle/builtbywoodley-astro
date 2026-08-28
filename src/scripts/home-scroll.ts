import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion, smoothScroll } from './smooth-scroll';

// The landing page is one continuous scroll: a full-height title, the about
// chapter, then the routes that are still their own pages. Every reveal below
// is scrubbed against the scroll position rather than fired once on entry, so
// scrolling back up plays the same motion in reverse instead of leaving a
// half-finished screen behind.

type ScrollAnimation = gsap.core.Animation & { scrollTrigger?: ScrollTrigger };

let cleanupActivePage = () => {};

/** The sticky nav overlaps the top of the page; chapters size around it. */
function measureNav() {
  const nav = document.querySelector<HTMLElement>('.top-nav');
  const height = nav ? nav.offsetHeight : 80;
  document.documentElement.style.setProperty('--top-nav-height', `${height}px`);
  return height;
}

function setupPage() {
  cleanupActivePage();

  const page = document.querySelector<HTMLElement>('.landing-page');
  if (!page) {
    cleanupActivePage = () => {};
    return;
  }

  const controller = new AbortController();
  const { signal } = controller;
  const reduceMotion = prefersReducedMotion();
  const lenis = smoothScroll();
  const animations: ScrollAnimation[] = [];

  measureNav();
  window.addEventListener('resize', measureNav, { passive: true, signal });

  const heroSection = page.querySelector<HTMLElement>('.chapter--hero');
  const heroCopy = page.querySelector<HTMLElement>('.hero-copy');
  const heroLines = gsap.utils.toArray<HTMLElement>('.hero-reveal > span', page);
  const heroTail = gsap.utils.toArray<HTMLElement>('[data-hero-tail]', page);

  // Whatever happens next, the hero is visible: the pre-paint hidden state in
  // CSS only exists so the reveal has somewhere to start from. Disarm before
  // touching GSAP — it reads the computed transform, and would otherwise fold
  // the CSS offset into a px `y` that survives every later tween.
  document.documentElement.removeAttribute('data-motion-armed');
  gsap.set(heroLines, { yPercent: 0, y: 0, opacity: 1 });
  gsap.set(heroTail, { y: 0, opacity: 1 });

  if (!reduceMotion) {
    const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
    intro
      .fromTo(
        heroLines,
        { yPercent: 118, y: 0 },
        { yPercent: 0, y: 0, duration: 1.25, stagger: 0.085 },
        0,
      )
      .fromTo(
        heroTail,
        { y: 22, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.95, stagger: 0.09 },
        0.42,
      );
    animations.push(intro);

    // The title drifts up and dims as the about chapter arrives underneath it.
    if (heroSection && heroCopy) {
      animations.push(
        gsap.to(heroCopy, {
          yPercent: -14,
          opacity: 0.06,
          ease: 'none',
          scrollTrigger: {
            trigger: heroSection,
            start: 'top top',
            end: 'bottom top',
            scrub: true,
            invalidateOnRefresh: true,
          },
        }),
      );
    }

    // The intro fades .scroll-cue-inner in; this fade takes the outer anchor.
    // Sharing one element would have the scrub record the intro's starting
    // opacity as the value to return to at the top of the page.
    const cue = page.querySelector<HTMLElement>('.scroll-cue');
    if (cue && heroSection) {
      animations.push(
        gsap.to(cue, {
          opacity: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: heroSection,
            start: 'top top',
            end: '+=30%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        }),
      );
    }

    // Chapter headings rise out of their mask as the heading reaches the fold.
    gsap.utils
      .toArray<HTMLElement>('.chapter-title .reveal-line > span', page)
      .forEach((line) => {
        animations.push(
          gsap.fromTo(
            line,
            { yPercent: 115 },
            {
              yPercent: 0,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: line,
                start: 'top bottom',
                end: 'top 68%',
                scrub: true,
                invalidateOnRefresh: true,
              },
            },
          ),
        );
      });

    // Each craft row draws its own rule, then lifts its title and copy.
    gsap.utils.toArray<HTMLElement>('.craft-row', page).forEach((row) => {
      const rule = row.querySelector<HTMLElement>('.craft-rule');
      const title = row.querySelector<HTMLElement>('.craft-title .reveal-line > span');
      const index = row.querySelector<HTMLElement>('.craft-index');
      const copy = row.querySelector<HTMLElement>('.craft-copy');

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: row,
          start: 'top bottom',
          end: 'top 45%',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      if (rule) timeline.fromTo(rule, { scaleX: 0 }, { scaleX: 1, ease: 'power2.inOut', duration: 1 }, 0);
      if (index) timeline.fromTo(index, { opacity: 0, y: 16 }, { opacity: 1, y: 0, ease: 'power2.out', duration: 0.8 }, 0.1);
      if (title) timeline.fromTo(title, { yPercent: 115 }, { yPercent: 0, ease: 'power3.out', duration: 0.95 }, 0.15);
      if (copy) timeline.fromTo(copy, { opacity: 0, y: 26 }, { opacity: 1, y: 0, ease: 'power2.out', duration: 0.85 }, 0.3);

      animations.push(timeline);
    });

    gsap.utils.toArray<HTMLElement>('[data-reveal]', page).forEach((element) => {
      animations.push(
        gsap.fromTo(
          element,
          { opacity: 0, y: 30 },
          {
            opacity: 1,
            y: 0,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: element,
              start: 'top bottom',
              end: 'top 72%',
              scrub: true,
              invalidateOnRefresh: true,
            },
          },
        ),
      );
    });
  }

  // Cuberto's rows track the pointer with a piece of media; these carry a soft
  // wash of the copper accent instead, which is all the colour scheme wants.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    gsap.utils.toArray<HTMLElement>('.craft-row', page).forEach((row) => {
      row.addEventListener(
        'pointermove',
        (event) => {
          const bounds = row.getBoundingClientRect();
          row.style.setProperty('--glow-x', `${event.clientX - bounds.left}px`);
          row.style.setProperty('--glow-y', `${event.clientY - bounds.top}px`);
        },
        { passive: true, signal },
      );
    });
  }

  // In-page jumps go through Lenis so they ease instead of teleporting.
  const scrollToTarget = (hash: string, immediate: boolean) => {
    const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
    if (!target) return false;
    lenis.scrollTo(target, { offset: -24, immediate: immediate || reduceMotion });
    return true;
  };

  // One handler for every same-document jump on this page: the cue, and the
  // nav's about tile, which points at /#about from everywhere. It runs in the
  // capture phase because Astro's router claims clicks on same-origin links in
  // the bubble phase — marking the event handled first is what stops /#about
  // from being treated as a navigation back to the page we are already on.
  const hashFor = (link: HTMLAnchorElement) => {
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('#') && !href.startsWith('/#')) return '';
    const hash = href.slice(href.indexOf('#'));
    return hash.length > 1 && document.getElementById(hash.slice(1)) ? hash : '';
  };

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (!link || (link.target && link.target !== '_self')) return;

      const hash = hashFor(link);
      if (!hash) return;

      event.preventDefault();
      history.replaceState(history.state, '', hash);
      scrollToTarget(hash, false);
    },
    { capture: true, signal },
  );

  ScrollTrigger.refresh();
  // Arriving from another page with /#about in the URL should land on the
  // chapter, not at the top of the document.
  if (location.hash.length > 1) scrollToTarget(location.hash, true);

  cleanupActivePage = () => {
    controller.abort();
    animations.forEach((animation) => {
      animation.scrollTrigger?.kill();
      animation.kill();
    });
    cleanupActivePage = () => {};
  };
}

document.addEventListener('astro:before-swap', () => cleanupActivePage());
document.addEventListener('astro:page-load', setupPage);

if (document.readyState === 'complete') setupPage();
