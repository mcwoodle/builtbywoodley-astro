import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from '@studio-freight/lenis';

gsap.registerPlugin(ScrollTrigger);

// One Lenis per page view, shared by everything that animates on scroll. The
// landing page and the journal both want smooth scrolling; two instances would
// fight over the same wheel events, so the lifecycle lives here instead of in
// either caller.
let instance: Lenis | null = null;
let frame = 0;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function smoothScroll(): Lenis {
  if (instance) return instance;

  const reduce = prefersReducedMotion();
  instance = new Lenis({
    smoothWheel: !reduce,
    syncTouch: false,
    duration: reduce ? 0 : 1.1,
  });
  instance.on('scroll', ScrollTrigger.update);

  const raf = (time: number) => {
    instance?.raf(time);
    frame = requestAnimationFrame(raf);
  };
  frame = requestAnimationFrame(raf);

  return instance;
}

export function stopSmoothScroll(): void {
  if (!instance) return;
  cancelAnimationFrame(frame);
  frame = 0;
  instance.destroy();
  instance = null;
}

// The router swaps the document out from under us; the next page asks for a
// fresh instance when its own setup runs.
document.addEventListener('astro:before-swap', stopSmoothScroll);
