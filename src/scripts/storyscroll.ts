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

      // Each element is triggered by its OWN position so it starts fully below
      // the fold: at 'top bottom' its natural top is on the viewport's bottom
      // edge and the +120 start offset pushes it just off-screen. As you scroll
      // it rises up from that bottom edge while fading in (expo.out) and
      // decelerating to 1:1, settling opaque and in place.
      //
      // The content sits lower in the entry, so it reaches the bottom edge
      // later than the title (a natural delay) and it covers its rise in half
      // the scroll distance ('top bottom' -> 'top 70%' vs the title's
      // 'top bottom' -> 'top 40%').
      if (title) {
        gsap.fromTo(
          title,
          { opacity: 0, y: 120 },
          {
            opacity: 1,
            y: 0,
            ease: 'expo.out',
            scrollTrigger: {
              trigger: title,
              start: 'top bottom',
              end: 'top 40%',
              scrub: true,
            },
          },
        );
      }
      if (content) {
        gsap.fromTo(
          content,
          { opacity: 0, y: 120 },
          {
            opacity: 1,
            y: 0,
            ease: 'expo.out',
            scrollTrigger: {
              trigger: content,
              start: 'top bottom',
              end: 'top 70%',
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

