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

    // Entry reveal — the title rises and fades in from the bottom edge as
    // before (12vh of travel over a long scrubbed range, settling around
    // mid-viewport), but the content no longer flies with it. It stays
    // planted at its 1:1 position and prints in top-to-bottom behind the
    // rising title, like a plotter laying ink:
    //   - the wipe starts at the scrub progress where the title's bottom
    //     edge has risen past the content's first line — before that the
    //     title itself occupies the band, so no dead gap can ever open;
    //   - after it, revealed text only ever sits below the title's path,
    //     so the two never collide and the content needs no opacity hiding.
    const reveal = {
      offsetVh: 0.12,
      start: 'top bottom',
      end: 'top 35%',
      ease: 'power1.out',
    };

    entries.forEach((entry) => {
      if (reduceMotion) return;
      const title = entry.querySelector<HTMLElement>('.project-title');
      const content = entry.querySelector<HTMLElement>('.project-content');

      const entryTop = entry.getBoundingClientRect().top;
      const titleRect = title?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: entry,
          start: reveal.start,
          end: reveal.end,
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      if (title && titleRect) {
        tl.fromTo(
          title,
          { opacity: 0, y: () => window.innerHeight * reveal.offsetVh - (titleRect.top - entryTop) },
          { opacity: 1, y: 0, ease: reveal.ease, duration: 1 },
          0,
        );
      }

      if (content && contentRect) {
        // Title travel K and resting gap G between title bottom and content
        // top. The title's bottom edge passes the content's first line when
        // (12vh - delta) * (1 - e(p)) = G; for power1.out e(p) = 1-(1-p)^2,
        // so pStart = 1 - sqrt(G / K). Clamped so degenerate layouts (no
        // gap, tiny viewports) still leave room for the wipe to play.
        let pStart = 0;
        if (titleRect) {
          const K = window.innerHeight * reveal.offsetVh - (titleRect.top - entryTop);
          const G = contentRect.top - titleRect.bottom;
          if (K > 0 && G < K) pStart = Math.min(0.6, 1 - Math.sqrt(Math.max(G, 0) / K));
        }

        // ease 'none': the print advances at a steady, mechanical rate tied
        // directly to scroll.
        tl.fromTo(
          content,
          { clipPath: 'inset(0% 0% 100% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', duration: 1 - pStart },
          pStart,
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

