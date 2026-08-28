import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { prefersReducedMotion, smoothScroll } from './smooth-scroll';
import { pinNav, releaseNav } from './nav-scroll-visibility';

gsap.registerPlugin(SplitText);

// The landing page is one continuous scroll arranged the way cuberto.com
// arranges one, and it leans on GSAP for all of it: a masked title reveal, a
// photograph that opens from a window to full bleed, a ticker that leans into
// the scroll, line-by-line copy, a pinned horizontal archive, and magnetic
// links.
//
// Everything scroll-linked is scrubbed rather than fired once on entry, so
// scrolling back up unplays the same motion instead of stranding a
// half-finished screen. Behaviour that only makes sense on a wide pointer
// screen — the pin, the pointer effects — lives in its own matchMedia context
// so GSAP tears it back out when the viewport stops qualifying.

let cleanupActivePage = () => {};

/** The sticky nav sits above the page in flow; the hero sizes around it. */
function measureNav() {
  const nav = document.querySelector<HTMLElement>('.top-nav');
  document.documentElement.style.setProperty(
    '--top-nav-height',
    `${nav ? nav.offsetHeight : 80}px`,
  );
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
  const lenis = smoothScroll();
  const reduceMotion = prefersReducedMotion();
  const media = gsap.matchMedia();
  const q = gsap.utils.selector(page);

  measureNav();
  window.addEventListener('resize', measureNav, { passive: true, signal });
  // Images settle after first paint and change every trigger's geometry.
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true, signal });

  const heroLines = q('.hero-reveal > span');
  const heroTail = q('[data-hero-tail]');

  // Whatever happens next, the hero is visible: the pre-paint hidden state in
  // CSS only exists so the reveal has somewhere to start from. Disarm before
  // touching GSAP — it reads the computed transform, and would otherwise fold
  // the CSS offset into a px `y` that survives every later tween.
  document.documentElement.removeAttribute('data-motion-armed');
  gsap.set(heroLines, { yPercent: 0, y: 0, opacity: 1 });
  gsap.set(heroTail, { y: 0, opacity: 1 });

  // ── Motion, for readers who have not asked for stillness ──
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const splits: SplitText[] = [];

    // 1 · The title arrives line by line, its lead a beat behind it.
    const lead = page.querySelector<HTMLElement>('[data-split-lead]');
    const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });

    intro.fromTo(
      heroLines,
      { yPercent: 118, y: 0 },
      { yPercent: 0, y: 0, duration: 1.25, stagger: 0.085 },
      0,
    );
    intro.fromTo(
      q('[data-hero-tail]:not([data-split-lead])'),
      { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.9, stagger: 0.09 },
      0.34,
    );

    if (lead) {
      const leadSplit = SplitText.create(lead, { type: 'lines,words', mask: 'lines' });
      splits.push(leadSplit);
      intro.from(
        leadSplit.words,
        { yPercent: 115, duration: 0.85, stagger: 0.012, ease: 'power3.out' },
        0.46,
      );
    }

    // The title gives way as the photograph comes up underneath it.
    const heroShell = page.querySelector<HTMLElement>('.hero-shell');
    const heroSection = page.querySelector<HTMLElement>('.chapter--hero');
    if (heroShell && heroSection) {
      gsap.to(heroShell, {
        yPercent: -12,
        opacity: 0.08,
        ease: 'none',
        scrollTrigger: {
          trigger: heroSection,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });
    }

    // 2 · The photograph opens from a rounded window to full bleed, with the
    //     frame drifting against its own crop the whole way past.
    const frame = page.querySelector<HTMLElement>('.showcase-frame');
    const showcaseMedia = page.querySelector<HTMLElement>('.showcase-media');
    const showcaseImage = page.querySelector<HTMLElement>('.showcase-image');
    const showcaseCaption = page.querySelector<HTMLElement>('.showcase-caption');

    if (frame && showcaseMedia) {
      gsap.fromTo(
        showcaseMedia,
        { clipPath: 'inset(0% 18% 0% 18% round 26px)' },
        {
          clipPath: 'inset(0% 0% 0% 0% round 0px)',
          ease: 'none',
          scrollTrigger: {
            trigger: frame,
            start: 'top 84%',
            end: 'top 10%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    }

    if (frame && showcaseImage) {
      gsap.fromTo(
        showcaseImage,
        { yPercent: -7, scale: 1.18 },
        {
          yPercent: 7,
          scale: 1.02,
          ease: 'none',
          scrollTrigger: {
            trigger: frame,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    }

    if (frame && showcaseCaption) {
      gsap.fromTo(
        showcaseCaption,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: frame,
            start: 'top 46%',
            end: 'top 14%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    }

    // 3 · The ticker drifts on its own, then takes the page's speed and
    //     direction from it — faster the harder you scroll, backwards when
    //     you scroll back up, easing to a drift when you stop.
    const marqueeTrack = page.querySelector<HTMLElement>('[data-marquee-track]');
    let removeTick: (() => void) | undefined;

    if (marqueeTrack) {
      const loop = gsap.to(marqueeTrack, {
        xPercent: -50,
        ease: 'none',
        duration: 26,
        repeat: -1,
      });

      let direction = 1;
      let speed = 1;
      const tick = () => {
        speed += (direction - speed) * 0.05;
        loop.timeScale(speed);
      };
      gsap.ticker.add(tick);
      removeTick = () => gsap.ticker.remove(tick);

      ScrollTrigger.create({
        trigger: page,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => {
          const velocity = self.getVelocity();
          direction = velocity < 0 ? -1 : 1;
          speed = direction * gsap.utils.clamp(1, 6, 1 + Math.abs(velocity) / 900);
        },
      });
    }

    // 4 · Section headings rise out of their masks.
    q('[data-mask-title] .reveal-line > span').forEach((line) => {
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
        );
    });

    // 5 · Each ruled row — the about rows and the history beneath them — draws
    //     its own rule, then lifts its meta line and title.
    q('[data-row]').forEach((row) => {
      const rule = row.querySelector<HTMLElement>('[data-row-rule]');
      const title = row.querySelector<HTMLElement>('[data-row-title] .reveal-line > span');
      const index = row.querySelector<HTMLElement>('[data-row-meta]');

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

    });

    // 5b · The work history gets its own set of moves. The spine fills behind
    //      a tenure's roles, each role's node pops as its title lands, and
    //      then the detail is drawn downwards out from under that title.
    q('[data-spine-fill]').forEach((fill) => {
      const list = fill.closest<HTMLElement>('[data-row-body]');
      if (!list) return;
      gsap.fromTo(
        fill,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: list,
            start: 'top 78%',
            end: 'bottom 72%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    // Beat one: the node lands with the title.
    q('[data-stint]').forEach((stint) => {
      const node = stint.querySelector<HTMLElement>('.history-node');
      if (!node) return;
      gsap.fromTo(
        node,
        { scale: 0 },
        {
          scale: 1,
          ease: 'back.out(2.4)',
          scrollTrigger: {
            trigger: stint,
            start: 'top 96%',
            end: 'top 82%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    // Beat two, once the title has settled: the clip opens downwards while the
    // detail slides down inside it, so the dates and the note read as though
    // they are being pulled out from behind the title rather than fading in
    // beside it. The bar draws last, after there is a track to draw it on.
    q('[data-stint-detail]').forEach((detail) => {
      const inner = detail.querySelector<HTMLElement>('[data-stint-detail-inner]');
      const bar = detail.querySelector<HTMLElement>('[data-bar]');
      const stint = detail.closest<HTMLElement>('[data-stint]') ?? detail;

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: stint,
          start: 'top 76%',
          end: 'top 46%',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      timeline.fromTo(
        detail,
        { clipPath: 'inset(0% 0% 100% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power2.out', duration: 1 },
        0,
      );
      if (inner) {
        timeline.fromTo(
          inner,
          { yPercent: -58 },
          { yPercent: 0, ease: 'power2.out', duration: 1 },
          0,
        );
      }
      if (bar) {
        timeline.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'power2.out', duration: 0.6 }, 0.55);
      }
    });

    q('[data-bundle-card]').forEach((card) => {
      gsap.fromTo(
        card,
        { opacity: 0, y: 22 },
        {
          opacity: 1,
          y: 0,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: card,
            start: 'top 94%',
            end: 'top 72%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    // Role titles come in a word at a time, the same way the hero's lead does.
    q('[data-stint-title]').forEach((title) => {
      splits.push(
        SplitText.create(title, {
          type: 'lines,words',
          mask: 'lines',
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.words, {
              yPercent: 112,
              duration: 0.9,
              stagger: 0.02,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: title,
                start: 'top 96%',
                end: 'top 78%',
                scrub: true,
                invalidateOnRefresh: true,
              },
            }),
        }),
      );
    });

    // ...and its copy arrives a line at a time. autoSplit re-cuts the lines
    // when the font lands or the column changes width, and rebuilds the
    // animation with them.
    q('[data-split-copy]').forEach((copy) => {
      splits.push(
        SplitText.create(copy, {
          type: 'lines',
          mask: 'lines',
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 108,
              duration: 1,
              stagger: 0.08,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: copy,
                start: 'top 94%',
                end: 'top 58%',
                scrub: true,
                invalidateOnRefresh: true,
              },
            }),
        }),
      );
    });

    // 6 · Work cards rise, and their covers uncrop as they come.
    q('.work-card').forEach((card) => {
      gsap.fromTo(
        card,
        { opacity: 0, y: 48 },
        {
          opacity: 1,
          y: 0,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: card,
            start: 'top bottom',
            end: 'top 68%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );

      const cover = card.querySelector<HTMLElement>('.work-card-media img');
      if (!cover) return;
      gsap.fromTo(
        cover,
        { clipPath: 'inset(12% 6% 12% 6%)', scale: 1.16 },
        {
          clipPath: 'inset(0% 0% 0% 0%)',
          scale: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: card,
            start: 'top bottom',
            end: 'top 55%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    // 7 · Everything else that just needs to arrive.
    q('[data-reveal]').forEach((element) => {
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
      );
    });

    return () => {
      removeTick?.();
      splits.forEach((split) => split.revert());
    };
  });

  // ── Wide pointer screens only ──
  //
  // The archive is a real horizontal scroller everywhere; here the page pins
  // it and drives the track from vertical scroll instead, which is only worth
  // taking a swipe away for on a screen with room for it.
  media.add(
    '(min-width: 761px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    () => {
      const gallery = page.querySelector<HTMLElement>('[data-gallery]');
      const track = page.querySelector<HTMLElement>('[data-gallery-track]');
      if (!gallery || !track) return;

      gallery.classList.add('is-pinned');
      const travel = () => Math.max(0, track.scrollWidth - gallery.clientWidth);

      gsap.to(track, {
        x: () => -travel(),
        ease: 'none',
        scrollTrigger: {
          trigger: gallery,
          start: 'center center',
          end: () => `+=${travel() + window.innerHeight * 0.35}`,
          pin: true,
          anticipatePin: 1,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });

      return () => {
        gallery.classList.remove('is-pinned');
        gsap.set(track, { x: 0 });
      };
    },
  );

  // Pointer effects: the wash that follows the cursor across a craft row, and
  // links that lean toward it. Both are meaningless without a real pointer.
  media.add('(hover: hover) and (pointer: fine)', () => {
    q('.craft-row').forEach((row) => {
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

    q('[data-row-body]').forEach((list) => {
      const stints = list.querySelectorAll<HTMLElement>('[data-stint]');
      if (stints.length < 2) return;

      stints.forEach((stint) => {
        stint.addEventListener(
          'pointerenter',
          () => {
            stints.forEach((other) => {
              gsap.to(other, {
                opacity: other === stint ? 1 : 0.34,
                duration: 0.42,
                ease: 'power2.out',
                overwrite: 'auto',
              });
            });
          },
          { signal },
        );
      });

      list.addEventListener(
        'pointerleave',
        () => {
          gsap.to(stints, { opacity: 1, duration: 0.42, ease: 'power2.out', overwrite: 'auto' });
        },
        { signal },
      );
    });

    q('[data-magnetic]').forEach((element) => {
      const xTo = gsap.quickTo(element, 'x', { duration: 0.5, ease: 'power3.out' });
      const yTo = gsap.quickTo(element, 'y', { duration: 0.5, ease: 'power3.out' });

      element.addEventListener(
        'pointermove',
        (event) => {
          const bounds = element.getBoundingClientRect();
          xTo((event.clientX - (bounds.left + bounds.width / 2)) * 0.28);
          yTo((event.clientY - (bounds.top + bounds.height / 2)) * 0.4);
        },
        { passive: true, signal },
      );
      element.addEventListener('pointerleave', () => { xTo(0); yTo(0); }, { signal });
      element.addEventListener('blur', () => { xTo(0); yTo(0); }, { signal });
    });
  });

  // ── Same-document jumps ──
  //
  // Runs in the capture phase because Astro's router claims clicks on
  // same-origin links in the bubble phase; marking the event handled first is
  // what stops the nav's /#about tile from being treated as a navigation back
  // to the page we are already on.
  // A scroll the reader asked for by clicking the nav should not make the nav
  // disappear on the way, so it is held in view for the whole trip and handed
  // back only once the page has settled.
  const scrollTo = (to: HTMLElement | number, immediate: boolean) => {
    pinNav();
    lenis.scrollTo(to, {
      offset: typeof to === 'number' ? 0 : -24,
      immediate: immediate || reduceMotion,
      onComplete: releaseNav,
    });
  };

  const scrollToTarget = (hash: string, immediate: boolean) => {
    const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
    if (!target) return false;
    scrollTo(target, immediate);
    return true;
  };

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

      // The house tile has somewhere to send you on this page: back up to the
      // top. Left alone at the top, where it genuinely has nowhere to go, the
      // nav's own handler still leans it and says so.
      const home = target.closest<HTMLElement>('[data-scroll-top]');
      if (home) {
        // Either way this is not a navigation to the page we are already on,
        // so the router does not get to treat it as one.
        event.preventDefault();
        if (window.scrollY <= 4) return;
        (event as MouseEvent & { pageHandled?: boolean }).pageHandled = true;
        scrollTo(0, false);
        return;
      }

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

  // The tile's label follows what it will actually do.
  const brand = document.querySelector<HTMLElement>('.top-nav [data-scroll-top]');
  if (brand) {
    const syncBrandLabel = () => {
      brand.dataset.tooltip = window.scrollY > 4 ? 'Back to top' : "You're home";
    };
    syncBrandLabel();
    window.addEventListener('scroll', syncBrandLabel, { passive: true, signal });
  }

  ScrollTrigger.refresh();
  // Arriving from another page with /#about in the URL should land on the
  // chapter, not at the top of the document.
  if (location.hash.length > 1) scrollToTarget(location.hash, true);

  cleanupActivePage = () => {
    controller.abort();
    media.revert();
    cleanupActivePage = () => {};
  };
}

document.addEventListener('astro:before-swap', () => cleanupActivePage());
document.addEventListener('astro:page-load', setupPage);

if (document.readyState === 'complete') setupPage();
