import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from '@studio-freight/lenis';
import { navigate } from 'astro:transitions/client';

gsap.registerPlugin(ScrollTrigger);

const STORY_STATE_KEY = 'bbwStoryScroll';
let cleanupActivePage = () => {};

function setupPage() {
  cleanupActivePage();

  const carousel = document.querySelector<HTMLElement>('.js-carousel-section');
  const entries = document.querySelectorAll<HTMLElement>('.js-project-entry');
  if (!carousel && entries.length === 0) {
    cleanupActivePage = () => {};
    return;
  }

  const controller = new AbortController();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animations: Array<gsap.core.Animation & { scrollTrigger?: ScrollTrigger }> = [];
  const lenis = new Lenis({
    smoothWheel: !reduceMotion,
    syncTouch: false,
    duration: reduceMotion ? 0 : 1.1,
  });
  let frame = 0;

  const raf = (time: number) => {
    lenis.raf(time);
    frame = requestAnimationFrame(raf);
  };
  frame = requestAnimationFrame(raf);
  lenis.on('scroll', ScrollTrigger.update);

  if (carousel) {
    animations.push(
      gsap.to(carousel, {
        scrollTrigger: {
          trigger: carousel,
          start: 'top top',
          end: '+=50%',
          scrub: true,
        },
        opacity: 0.25,
      }),
    );
  }

  if (!reduceMotion) {
    const reveal = {
      offsetVh: 0.12,
      start: 'top bottom',
      end: 'top 35%',
      ease: 'power1.out',
    };

    entries.forEach((entry) => {
      const title = entry.querySelector<HTMLElement>('.project-title');
      const content = entry.querySelector<HTMLElement>('.project-content');
      const entryTop = entry.getBoundingClientRect().top;
      const titleRect = title?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: entry,
          start: reveal.start,
          end: reveal.end,
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      if (title && titleRect) {
        timeline.fromTo(
          title,
          { opacity: 0, y: () => window.innerHeight * reveal.offsetVh - (titleRect.top - entryTop) },
          { opacity: 1, y: 0, ease: reveal.ease, duration: 1 },
          0,
        );
      }

      if (content && contentRect) {
        let startProgress = 0;
        if (titleRect) {
          const travel = window.innerHeight * reveal.offsetVh - (titleRect.top - entryTop);
          const gap = contentRect.top - titleRect.bottom;
          if (travel > 0 && gap < travel) {
            startProgress = Math.min(0.6, 1 - Math.sqrt(Math.max(gap, 0) / travel));
          }
        }
        timeline.fromTo(
          content,
          { clipPath: 'inset(0% 0% 100% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', duration: 1 - startProgress },
          startProgress,
        );
      }

      animations.push(timeline);
    });
  }

  const navOffset = () => {
    const nav = document.querySelector<HTMLElement>('.top-nav');
    return nav ? -(nav.clientHeight + 12) : 0;
  };

  const scrollToEntry = (id: string, immediate: boolean) => {
    const element = document.getElementById(id);
    if (!element) return false;
    lenis.scrollTo(element, { offset: navOffset(), immediate: immediate || reduceMotion });
    return true;
  };

  const restoreScroll = (top: number) => {
    lenis.scrollTo(top, { immediate: true, force: true });
    requestAnimationFrame(() => lenis.scrollTo(top, { immediate: true, force: true }));
  };

  document.querySelectorAll<HTMLAnchorElement>('.js-carousel-card a[href^="#"]').forEach((card) => {
    card.addEventListener(
      'click',
      async (event) => {
        const id = (card.getAttribute('href') || '').slice(1);
        if (!id || !document.getElementById(id)) return;
        event.preventDefault();

        const currentState = history.state && typeof history.state === 'object' ? history.state : {};
        history.replaceState(
          { ...currentState, [STORY_STATE_KEY]: { scrollY: window.scrollY } },
          '',
          location.href,
        );
        await navigate(`#${id}`, {
          state: { [STORY_STATE_KEY]: { entryId: id } },
        });
        scrollToEntry(id, false);
      },
      { signal: controller.signal },
    );
  });

  window.addEventListener(
    'popstate',
    (event) => {
      const state = event.state?.[STORY_STATE_KEY] as
        | { scrollY?: number; entryId?: string }
        | undefined;
      if (typeof state?.scrollY === 'number') restoreScroll(state.scrollY);
      else if (state?.entryId) scrollToEntry(state.entryId, true);
      else if (location.hash.length > 1) scrollToEntry(location.hash.slice(1), true);
    },
    { signal: controller.signal },
  );

  if (location.hash.length > 1) scrollToEntry(location.hash.slice(1), true);
  ScrollTrigger.refresh();

  cleanupActivePage = () => {
    controller.abort();
    cancelAnimationFrame(frame);
    animations.forEach((animation) => {
      animation.scrollTrigger?.kill();
      animation.kill();
    });
    lenis.destroy();
    cleanupActivePage = () => {};
  };
}

document.addEventListener('astro:before-swap', () => cleanupActivePage());
document.addEventListener('astro:page-load', setupPage);

if (document.readyState === 'complete') setupPage();
