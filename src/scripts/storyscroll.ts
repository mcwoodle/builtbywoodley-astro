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

    // Entry reveal — "scribe and settle". The entry rises as one block from a
    // hand's-breadth below its slot, so no gap can open between title and
    // body. Two beats play inside the block as it travels:
    //   1. the title wipes in left-to-right — the same pencil-stroke cue as
    //      the eyebrow scribe lines and the craft-link rule;
    //   2. the body fades up trailing the title by lagPx, tucking flush as
    //      the block lands (same ease, so the lag shrinks smoothly to zero).
    // The scrub range tracks the entry's natural 1:1 position (the entry
    // itself is never transformed) and ends mid-viewport, so an entry is
    // fully resolved by the time it reaches the reading line.
    const reveal = {
      offsetVh: 0.06, // block travel as a fraction of the viewport height
      lagPx: 24, // extra travel on the body — its trailing distance
      start: 'top bottom',
      end: 'top 55%',
      ease: 'power2.out',
    };

    entries.forEach((entry) => {
      if (reduceMotion) return;
      const title = entry.querySelector<HTMLElement>('.project-title');
      const body = [
        entry.querySelector<HTMLElement>('.project-content'),
        entry.querySelector<HTMLElement>('.post-end-mark'),
      ].filter((el): el is HTMLElement => el !== null);
      if (!title && body.length === 0) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: entry,
          start: reveal.start,
          end: reveal.end,
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      if (title) {
        tl.fromTo(
          title,
          { y: () => window.innerHeight * reveal.offsetVh },
          { y: 0, ease: reveal.ease, duration: 1 },
          0,
        );
        // Hard-edged on purpose: it reads as a stroke being drawn, not a fade.
        tl.fromTo(
          title,
          { clipPath: 'inset(0% 100% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power1.inOut', duration: 0.4 },
          0,
        );
      }

      if (body.length > 0) {
        tl.fromTo(
          body,
          { y: () => window.innerHeight * reveal.offsetVh + reveal.lagPx },
          { y: 0, ease: reveal.ease, duration: 1 },
          0,
        );
        tl.fromTo(body, { opacity: 0 }, { opacity: 1, ease: 'none', duration: 0.5 }, 0.1);
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

