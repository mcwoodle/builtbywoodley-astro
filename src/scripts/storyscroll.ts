import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from '@studio-freight/lenis';

gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis({
  smoothWheel: true,
  syncTouch: false,
  duration: 1.1,
});

function raf(time: number) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);

// Let ScrollTrigger react to Lenis-powered scroll updates
lenis.on('scroll', ScrollTrigger.update);

document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector<HTMLElement>('.js-carousel-section');
  const entries = document.querySelectorAll<HTMLElement>('.js-project-entry');

  if (carousel) {
    gsap.to(carousel, {
      scrollTrigger: {
        trigger: carousel,
        start: 'top top',
        end: '+=50%',
        scrub: true,
      },
      opacity: 0.25,
    });
  }

  if (entries.length > 0) {
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    entries.forEach((entry) => {
      if (reduceMotion) return;
      const title = entry.querySelector<HTMLElement>('.project-title');
      const content = entry.querySelector<HTMLElement>('.project-content');

      // The entry is never transformed, so triggering off it makes start/end
      // track each element's natural (1:1) resting position rather than its
      // animated one.
      //
      // Title: begins revealing once its resting place is a quarter of the way
      // up the viewport ('top 75%') and eases (expo.out) to 1:1 by the time
      // that spot is three-quarters up ('top 25%').
      if (title) {
        gsap.fromTo(
          title,
          { opacity: 0, y: 120 },
          {
            opacity: 1,
            y: 0,
            ease: 'expo.out',
            scrollTrigger: {
              trigger: entry,
              start: 'top 75%',
              end: 'top 25%',
              scrub: true,
            },
          },
        );
      }
      // Content: starts once the title is three-quarters of the way to its
      // resting place. expo.out covers 3/4 of the distance at ~20% of the
      // title's scroll range, which lands at 'top 65%'. It then settles over
      // half the title's scroll distance (ends at 'top 40%').
      if (content) {
        gsap.fromTo(
          content,
          { opacity: 0, y: 120 },
          {
            opacity: 1,
            y: 0,
            ease: 'expo.out',
            scrollTrigger: {
              trigger: entry,
              start: 'top 65%',
              end: 'top 40%',
              scrub: true,
            },
          },
        );
      }
    });
  }

  setupCarouselScroll();
});

// ── Recent-stuff cards → in-page project log entries ─────────────────
// A card click smooth-scrolls to the matching entry in the project log
// (instead of opening its standalone page) and records the pre-click
// scroll position so the Back button returns the reader exactly there.
// The standalone page stays reachable only via the entry's title link.
function setupCarouselScroll() {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  // Leave room for the sticky top nav so the entry isn't tucked behind it.
  const navOffset = () => {
    const nav = document.querySelector<HTMLElement>('.top-nav');
    return nav ? -(nav.clientHeight + 12) : 0;
  };

  const scrollToEntry = (id: string, immediate: boolean) => {
    const el = document.getElementById(id);
    if (!el) return false;
    lenis.scrollTo(el, { offset: navOffset(), immediate });
    return true;
  };

  const cards = document.querySelectorAll<HTMLAnchorElement>(
    '.js-carousel-card a[href^="#"]',
  );

  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      const id = (card.getAttribute('href') || '').slice(1);
      if (!id || !document.getElementById(id)) return; // let the link fall through
      event.preventDefault();
      // Stash the current position on this entry, then push a new one so Back
      // lands on the saved position and Forward returns to the entry.
      history.replaceState({ scrollY: window.scrollY }, '', location.href);
      history.pushState({ entryId: id }, '', `#${id}`);
      scrollToEntry(id, false);
    });
  });

  const restoreScroll = (y: number) => {
    // immediate jumps without animation; re-assert next frame so the
    // smooth-scroll RAF can't drift away from the restored position.
    lenis.scrollTo(y, { immediate: true, force: true });
    requestAnimationFrame(() => lenis.scrollTo(y, { immediate: true, force: true }));
  };

  window.addEventListener('popstate', (event) => {
    const state = event.state as
      | { scrollY?: number; entryId?: string }
      | null;
    if (state && typeof state.scrollY === 'number') {
      restoreScroll(state.scrollY);
    } else if (state && state.entryId) {
      scrollToEntry(state.entryId, true);
    } else if (location.hash.length > 1) {
      scrollToEntry(location.hash.slice(1), true);
    } else {
      restoreScroll(0);
    }
  });
}

