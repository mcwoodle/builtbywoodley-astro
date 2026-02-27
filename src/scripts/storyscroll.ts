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
        pin: true,
        scrub: true,
      },
      opacity: 0.25,
    });
  }

  if (entries.length > 0) {
    entries.forEach((entry) => {
      gsap.fromTo(
        entry,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          ease: 'power2.out',
          duration: 0.6,
          scrollTrigger: {
            trigger: entry,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          },
        },
      );
    });
  }

  // Reveal the projects log now that ScrollTrigger has set up pin-spacing
  const projectsLog = document.querySelector<HTMLElement>('.js-projects-log');
  if (projectsLog) {
    projectsLog.style.opacity = '1';
  }
});

