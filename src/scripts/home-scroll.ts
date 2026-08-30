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

  // ── The line the whole history hangs off ──
  //
  // One path over every row rather than a piece per role, so it runs unbroken
  // from the degree through to the stop still ahead instead of stopping dead at
  // each employer. It has to be measured rather than declared: how far it is
  // from one stop to the next is however tall the role in between turned out to
  // be, which is not a thing CSS can be told up front.
  //
  // Built out here rather than inside a motion context, so a reader who asked
  // for stillness still gets the finished line — only the reveal is motion.
  const historyBody = page.querySelector<HTMLElement>('[data-history-body]');
  const trackSvg = page.querySelector<SVGSVGElement>('[data-track-svg]');
  const trackBase = page.querySelector<SVGPathElement>('[data-track-base]');
  const trackLine = page.querySelector<SVGPathElement>('[data-track-line]');
  const trackDefs = page.querySelector<SVGDefsElement>('[data-track-defs]');
  const trackMask = page.querySelector<SVGMaskElement>('[data-track-mask]');
  const maskField = page.querySelector<SVGRectElement>('[data-mask-field]');
  const marker = page.querySelector<HTMLElement>('[data-marker]');

  // A promotion's jog outwards is drawn as a short diagonal rather than a right
  // angle. It reads as a climb, and — the reason it is here — it gives the step
  // a height, which is what lets a point on the line be found from a y alone.
  const STEP_RISE = 14;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** A corner of the line, with how far along the line it is. */
  type Vertex = { x: number; y: number; at: number };
  let vertices: Vertex[] = [];
  /** Each stop the line passes through, and the year it is. */
  let stops: { y: number; year: number }[] = [];
  let lineLength = 0;
  /** Where the last stop is, so the run on past it can be faded over. */
  let lastStopAt = 0;
  /** A word the line runs through, and the stretch it is gone over. */
  let crossings: { top: number; bottom: number }[] = [];
  // How far clear of the ink the line is gone entirely — enough that it visibly
  // stops short of a mark rather than running up against it — and how far either
  // side of that it takes to go, which is what makes it a dissolve.
  const CROSS_PAD = 10;
  const CROSS_FADE = 18;
  // How far into something the line has to reach before it counts as crossing.
  const CROSS_BITE = 4;

  const buildTrack = () => {
    if (!historyBody || !trackSvg || !trackBase || !trackLine) return;

    const frame = historyBody.getBoundingClientRect();
    // Read off the nodes rather than the cards: they are the thing the line is
    // meant to join, and their centres do not move when the script scales them.
    const points = [
      ...historyBody.querySelectorAll<HTMLElement>('[data-stint] .history-node'),
    ].map((node) => {
      const box = node.getBoundingClientRect();
      const stint = node.closest<HTMLElement>('[data-stint]');
      return {
        x: box.left + box.width / 2 - frame.left,
        y: box.top + box.height / 2 - frame.top,
        year: Number(stint?.dataset.year) || 0,
      };
    });
    if (points.length < 2) return;

    vertices = [];
    const push = (x: number, y: number) => vertices.push({ x, y, at: 0 });
    push(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      // Only a change of rung needs a corner to turn at.
      if (Math.abs(points[i].x - points[i - 1].x) > 0.5) {
        push(points[i - 1].x, points[i].y - STEP_RISE);
      }
      push(points[i].x, points[i].y);
    }
    const lastStop = vertices.length - 1;
    const lastStopY = vertices[lastStop].y;
    // On past the last stop by exactly the length it is faded out over, so the
    // line dissolves from the moment it has delivered you to the link rather
    // than running on down the page first. The body reserves that much padding
    // underneath for it, which is where the number comes from.
    const trailRun = Math.max(
      40,
      parseFloat(getComputedStyle(historyBody).paddingBottom) || 90,
    );
    push(points[points.length - 1].x, lastStopY + trailRun);

    lineLength = 0;
    for (let i = 1; i < vertices.length; i += 1) {
      const a = vertices[i - 1];
      const b = vertices[i];
      lineLength += Math.hypot(b.x - a.x, b.y - a.y);
      b.at = lineLength;
    }
    lastStopAt = vertices[lastStop].at;
    stops = points.map((point) => ({ y: point.y, year: point.year }));

    // Which pieces of a row the line actually runs through — its mark as much
    // as its name. In a two-column layout they are a whole column away from the
    // line and never meet it; stacked, the line goes straight down the middle
    // of them. The last block is centred on the line on purpose and is crossed
    // at every width. Testing the geometry rather than the breakpoint means the
    // answer stays right in all three cases, and nothing is dissolved that is
    // not in the way.
    //
    // It has to be a real overlap, not a shared edge: stacked, a heading starts
    // within a pixel of where the line runs, and a band there would dissolve
    // the line for a word it never touches.
    const lineLeft = Math.min(...vertices.map((v) => v.x));
    const lineRight = Math.max(...vertices.map((v) => v.x));
    const lineTop = vertices[0].y;
    const lineBottom = vertices[vertices.length - 1].y;
    crossings = [];
    historyBody.querySelectorAll<HTMLElement>('[data-ink]').forEach((ink) => {
      const box = ink.getBoundingClientRect();
      // The word rides up into place on a transform of its own, so where it is
      // right now is not where it comes to rest. Its height and its horizontal
      // reach are true either way; only the top has to be taken off the mask
      // around it, which nothing moves. Measuring the word itself here would
      // leave the gap wherever the reveal happened to be mid-flight.
      // Where the thing rests, which is not always where it is drawn. A name
      // rides up into place on a transform of its own, so its mask — which
      // nothing moves — is measured instead. A mark has no mask, so its height
      // is taken from layout, where no transform reaches, and hung off the
      // middle of its box, which a scale about the centre does not move either.
      const mask = ink.closest('.reveal-line');
      const rest = mask
        ? mask.getBoundingClientRect().top - frame.top
        : box.top + box.height / 2 - frame.top - (ink.offsetHeight || box.height) / 2;
      const height = mask ? box.height : ink.offsetHeight || box.height;
      const top = rest - CROSS_PAD;
      const bottom = rest + height + CROSS_PAD;
      if (
        box.right - frame.left > lineLeft + CROSS_BITE &&
        box.left - frame.left < lineRight - CROSS_BITE &&
        top - CROSS_FADE > lineTop &&
        bottom + CROSS_FADE < lineBottom
      ) {
        crossings.push({ top, bottom });
      }
    });

    // Painted into the mask as a soft-edged band each: white either side, black
    // over the word, and a gradient between the two. The line thins away into
    // the heading and thickens back up underneath rather than stopping dead at
    // an edge it has no reason to stop at.
    if (trackMask && maskField) {
      maskField.setAttribute('width', String(frame.width));
      maskField.setAttribute('height', String(frame.height));
      trackMask.querySelectorAll('[data-mask-band]').forEach((band) => band.remove());
      trackDefs?.querySelectorAll('[data-mask-veil]').forEach((veil) => veil.remove());

      const veil = (index: number, stops: [string, string][]) => {
        const id = `history-veil-${index}`;
        const gradient = document.createElementNS(SVG_NS, 'linearGradient');
        gradient.setAttribute('data-mask-veil', '');
        gradient.setAttribute('id', id);
        gradient.setAttribute('x1', '0');
        gradient.setAttribute('y1', '0');
        gradient.setAttribute('x2', '0');
        gradient.setAttribute('y2', '1');
        stops.forEach(([offset, colour]) => {
          const stop = document.createElementNS(SVG_NS, 'stop');
          stop.setAttribute('offset', offset);
          stop.setAttribute('stop-color', colour);
          gradient.appendChild(stop);
        });
        trackDefs?.appendChild(gradient);
        return `url(#${id})`;
      };

      const band = (y: number, height: number, fill: string) => {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('data-mask-band', '');
        rect.setAttribute('x', '0');
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(frame.width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('fill', fill);
        trackMask.appendChild(rect);
      };

      crossings.forEach((crossing, index) => {
        const height = crossing.bottom - crossing.top + CROSS_FADE * 2;
        const edge = CROSS_FADE / height;
        band(
          crossing.top - CROSS_FADE,
          height,
          veil(index, [
            ['0', '#fff'],
            [String(edge), '#000'],
            [String(1 - edge), '#000'],
            ['1', '#fff'],
          ]),
        );
      });

      // And the run past the last stop, which is nothing but its own fade.
      band(
        lastStopY,
        trailRun,
        veil(crossings.length, [
          ['0', '#fff'],
          ['1', '#000'],
        ]),
      );
    }

    const d = vertices
      .map((v, i) => `${i ? 'L' : 'M'}${v.x.toFixed(1)} ${v.y.toFixed(1)}`)
      .join('');
    trackSvg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
    trackBase.setAttribute('d', d);
    trackLine.setAttribute('d', d);
  };

  // Where the line has got to, given the y it has reached. The vertices climb
  // in y and never repeat one — which is what the diagonal jogs buy — so one
  // walk down the list finds the segment the point is on.
  const pointAt = (y: number) => {
    const last = vertices[vertices.length - 1];
    if (y <= vertices[0].y) return { x: vertices[0].x, y: vertices[0].y, at: 0 };
    for (let i = 1; i < vertices.length; i += 1) {
      const b = vertices[i];
      if (y > b.y) continue;
      const a = vertices[i - 1];
      const t = (y - a.y) / (b.y - a.y);
      return { x: a.x + (b.x - a.x) * t, y, at: a.at + (b.at - a.at) * t };
    }
    return { x: last.x, y: last.y, at: last.at };
  };

  // The year at that same point: whatever the two stops either side of it say,
  // read across the distance between them.
  const yearAt = (y: number) => {
    if (y <= stops[0].y) return stops[0].year;
    for (let i = 1; i < stops.length; i += 1) {
      const b = stops[i];
      if (y > b.y) continue;
      const a = stops[i - 1];
      return a.year + ((b.year - a.year) * (y - a.y)) / (b.y - a.y);
    }
    return stops[stops.length - 1].year;
  };

  // ── The ticker's strip has to be wider than the window ──
  //
  // It loops by shifting the track the width of one run, so the track has to
  // carry the window plus that run — otherwise the shift drags the end of the
  // last run into view and you can see where the words stop. The markup ships
  // the two runs the wrap needs at a minimum; how many more it takes depends on
  // the window, which is only known here. The type is clamped, so a run stops
  // widening long before a large monitor does: this is not something a bigger
  // font would solve.
  //
  // Out here rather than in the motion context because a short strip is just as
  // wrong standing still.
  const marqueeTrack = page.querySelector<HTMLElement>('[data-marquee-track]');
  /** One run's width, which is the distance the loop repeats over. */
  let marqueeSpan = 1;

  const fillMarquee = () => {
    const run = marqueeTrack?.querySelector<HTMLElement>('.marquee-run');
    if (!marqueeTrack || !run) return;
    marqueeSpan = run.getBoundingClientRect().width || marqueeSpan;
    const wanted = Math.ceil(window.innerWidth / marqueeSpan) + 1;
    for (let have = marqueeTrack.childElementCount; have < wanted; have += 1) {
      const copy = run.cloneNode(true) as HTMLElement;
      copy.dataset.marqueeCopy = '';
      marqueeTrack.appendChild(copy);
    }
  };

  const remeasure = () => {
    fillMarquee();
    buildTrack();
  };

  remeasure();
  ScrollTrigger.addEventListener('refreshInit', remeasure);

  // ── Motion, for readers who have not asked for stillness ──
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const splits: SplitText[] = [];
    // Anything that writes over real text has to be able to put it back when
    // the context is torn down — a resize past a breakpoint, say — or it is
    // left frozen mid-animation.
    const restores: (() => void)[] = [];

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

    // 3 · The ticker drifts leftwards for ever, and can be pushed around.
    //
    //     Not a tween. A tween has a start and an end, and a repeating one wound
    //     back to its own start has nowhere left to go — which is what used to
    //     make it stall. This is a position that wraps: the runs are identical,
    //     so shifting by the width of one lands exactly where it began. It can
    //     be wound in either direction, as far as you like, for ever.
    //
    //     Everything acts on one number, the speed. It eases towards the drift
    //     it is meant to be doing — so a hard fling bleeds off, a slow one is
    //     wound back up, and scrolling the page leans on it in passing — and
    //     while a finger is down it is the finger's, directly.
    const marquee = page.querySelector<HTMLElement>('[data-marquee]');
    let stopMarquee: (() => void) | undefined;

    if (marquee && marqueeTrack) {
      // The pace it settles back to, kept relative to the run so the words go
      // by at the same rate whatever the column is doing.
      const drift = () => -marqueeSpan / 26;

      let offset = 0;
      let speed = drift();
      let onScreen = false;
      let held = false;
      let heldAt = 0;
      let heldWhen = 0;
      let flung = 0;

      const place = () => {
        gsap.set(marqueeTrack, { x: gsap.utils.wrap(-marqueeSpan, 0, offset) });
      };

      const tick = (_time: number, delta: number) => {
        if (held || !onScreen) return;
        // Capped: coming back to a backgrounded tab hands over one enormous
        // frame, and the ticker should not have leapt while you were away.
        const seconds = Math.min(delta, 50) / 1000;
        // Framerate-independent friction — the same curve on 60Hz and 120Hz.
        speed += (drift() - speed) * (1 - Math.exp(-seconds * 2.6));
        offset += speed * seconds;
        place();
      };
      gsap.ticker.add(tick);

      const take = (event: PointerEvent) => {
        held = true;
        heldAt = event.clientX;
        heldWhen = event.timeStamp;
        flung = 0;
        marquee.dataset.dragging = '';
        // Capture only keeps the drag alive past the ticker's own edges. It is
        // a nicety, and it throws on a pointer the browser has already let go
        // of, so it must not be what the drag depends on having worked.
        try {
          marquee.setPointerCapture(event.pointerId);
        } catch {
          /* dragging still works, it just ends at the edge */
        }
      };

      const move = (event: PointerEvent) => {
        if (!held) return;
        const by = event.clientX - heldAt;
        const since = Math.max(1, event.timeStamp - heldWhen);
        offset += by;
        // Smoothed, so one stuttery sample cannot decide the whole fling.
        flung = flung * 0.7 + ((by / since) * 1000) * 0.3;
        heldAt = event.clientX;
        heldWhen = event.timeStamp;
        place();
      };

      const release = (event: PointerEvent) => {
        if (!held) return;
        held = false;
        speed = flung;
        delete marquee.dataset.dragging;
        try {
          marquee.releasePointerCapture(event.pointerId);
        } catch {
          /* nothing was captured */
        }
      };

      marquee.addEventListener('pointerdown', take, { signal });
      marquee.addEventListener('pointermove', move, { signal });
      marquee.addEventListener('pointerup', release, { signal });
      marquee.addEventListener('pointercancel', release, { signal });
      marquee.dataset.grab = '';

      stopMarquee = () => {
        gsap.ticker.remove(tick);
        delete marquee.dataset.grab;
        delete marquee.dataset.dragging;
      };

      // Only while it is on screen: there is nothing to see in it otherwise,
      // and a ticker left turning is a frame's work every frame.
      const shown = ScrollTrigger.create({
        trigger: marquee,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => {
          onScreen = self.isActive;
        },
        // The strip is re-measured and topped up on refresh above; this only
        // has to put the track back where the new measurement says.
        onRefresh: place,
      });
      // onToggle only reports a change, which says nothing about the state the
      // page happened to load in.
      onScreen = shown.isActive;

      // Scrolling leans on it in passing. A shove rather than a setting: the
      // friction above is what carries it, so it is always on its way back to
      // the drift rather than held above it by a page that stopped moving.
      ScrollTrigger.create({
        trigger: page,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => {
          if (held) return;
          speed = drift() * gsap.utils.clamp(1, 6, 1 + Math.abs(self.getVelocity()) / 900);
        },
      });

      place();
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

    // 5b · The work history is a ladder, and every role is a stop on it.
    //
    //      A role sits one notch further from the left edge for every rung of
    //      seniority it has climbed, so a promotion is a visible jog outwards
    //      and a sideways move is a straight line — the same fact the words
    //      beside it carry. The line itself is the one path built above; what
    //      happens here is the reveal of it, the single year riding its leading
    //      edge, and what each stop does as that edge arrives at it.
    //
    //      What arrives alongside the line depends on what kind of move the
    //      role was. index.astro works that out from the manifest and writes it
    //      onto the element as data-move, so a role added later still turns up
    //      with a motion of its own rather than nothing.
    //
    //      The sideways moves are told with a wipe rather than a long slide:
    //      there is only about ten pixels of gutter to the right of the roles
    //      at 320px, and anything that overshoots it puts the whole document
    //      into horizontal scroll. So the clip carries the direction and the
    //      translate is only enough to give it some weight behind it.
    const ENTRANCES: Record<string, { from: gsap.TweenVars; to: gsap.TweenVars }> = {
      // The degree: the whole thing settles in from below, under its crest.
      enroll: { from: { opacity: 0, y: 34 }, to: { opacity: 1, y: 0 } },
      // The co-op terms, arriving as a block before their cards are dealt.
      terms: { from: { opacity: 0, y: 20 }, to: { opacity: 1, y: 0 } },
      // First job out of school — steps out from the left, opening as it comes.
      launch: {
        from: { opacity: 0, x: -14, clipPath: 'inset(0% 100% 0% 0%)' },
        to: { opacity: 1, x: 0, clipPath: 'inset(0% 0% 0% 0%)' },
      },
      // A new employer at the rung already held: in from the other side.
      join: {
        from: { opacity: 0, x: 10, clipPath: 'inset(0% 0% 0% 100%)' },
        to: { opacity: 1, x: 0, clipPath: 'inset(0% 0% 0% 0%)' },
      },
      // A new team at the same rung. Purely lateral, and only half a wipe,
      // because the move itself is a shuffle along rather than an arrival.
      sidestep: {
        from: { opacity: 0, x: 10, clipPath: 'inset(0% 0% 0% 55%)' },
        to: { opacity: 1, x: 0, clipPath: 'inset(0% 0% 0% 0%)' },
      },
      // A step up, so it lifts.
      promote: { from: { opacity: 0, y: 32 }, to: { opacity: 1, y: 0 } },
      // The highest rung reached: lifts further, and out of a slight shrink.
      summit: {
        from: { opacity: 0, y: 42, scale: 0.965 },
        to: { opacity: 1, y: 0, scale: 1 },
      },
      // The stop still ahead. Nothing has happened yet, so it opens rather
      // than arrives: up out of a shrink, with nothing lateral about it.
      coda: {
        from: { opacity: 0, y: 26, scale: 0.94 },
        to: { opacity: 1, y: 0, scale: 1 },
      },
    };
    // Where the longest of those beats — a promotion's halo — finishes.
    const BEATS_END = 2.1;

    q('[data-stint]').forEach((stint) => {
      const node = stint.querySelector<HTMLElement>('.history-node');
      const halo = stint.querySelector<HTMLElement>('[data-halo]');
      const card = stint.querySelector<HTMLElement>('[data-stint-card]');
      const flag = stint.querySelector<HTMLElement>('[data-flag]');
      const roll = stint.querySelector<HTMLElement>('[data-rung-track]');
      const move = stint.dataset.move ?? 'sidestep';
      const summit = move === 'summit';

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: stint,
          start: 'top 96%',
          end: 'top 64%',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      const entrance = ENTRANCES[move] ?? ENTRANCES.sidestep;
      if (card) {
        timeline.fromTo(
          card,
          entrance.from,
          { ...entrance.to, duration: 1, ease: 'power3.out' },
          0,
        );
      }
      // The node lands when the line's leading edge reaches it: 1.05 of a
      // timeline that ends at 2.1, off a window from 96% to 64%, puts it at
      // 76% of the viewport — which is the reading line the track's own reveal
      // is pinned to further down.
      if (node) timeline.fromTo(node, { scale: 0 }, { scale: 1, ease: 'back.out(2.6)', duration: 0.5 }, 1.05);

      // Only a step up gets the rest of it: the ring off the node, the flag,
      // and the rung left behind rolling up out of the way.
      if (halo) {
        timeline
          .fromTo(
            halo,
            { scale: 0.3, opacity: 0 },
            { scale: 1, opacity: summit ? 0.75 : 0.55, duration: 0.35, ease: 'power2.out' },
            1.15,
          )
          .to(
            halo,
            { scale: summit ? 3.2 : 2, opacity: 0, duration: 0.6, ease: 'power2.out' },
            1.5,
          );
      }
      // Reaching the top rung is worth a slightly bigger marker to stop on.
      if (summit && node) {
        timeline.to(node, { scale: 1.35, duration: 0.4, ease: 'power2.out' }, 1.5);
      }
      if (flag) {
        timeline.fromTo(
          flag,
          { opacity: 0, x: -12, scale: 0.88 },
          { opacity: 1, x: 0, scale: 1, duration: 0.45, ease: 'back.out(2)' },
          1.2,
        );
      }
      if (roll) {
        // CSS rests the track on the arrived-at rung, so this only has to start
        // it a line higher and let it fall back to where it already is. `y: 0`
        // on both ends for the same reason the hero needs it: GSAP reads that
        // resting translate as a px `y` and would otherwise add the roll on top
        // of it, carrying the track a whole line past both words.
        timeline.fromTo(
          roll,
          { yPercent: 0, y: 0 },
          { yPercent: -50, y: 0, duration: 0.55, ease: 'power3.inOut' },
          1.25,
        );
      }
      // Every stint is scrubbed across the same window, so they all have to run
      // the same length. Left to itself a quiet role's timeline ends at 1.55
      // and lands its node seven points of viewport higher than a promotion
      // does — and the line's leading edge, pinned to one reading line for the
      // whole history, would then arrive at half of them long after they had
      // popped. Padding to the longest is what keeps the two together.
      timeline.set({}, {}, BEATS_END);
    });

    // The line draws itself, and the one year on the ladder rides the tip of
    // it. Both come off the same number, so the year is never anywhere the
    // line has not reached.
    //
    // The tip is pinned to 76% of the viewport — the same reading line each
    // stop's node pops on — and the path is walked by y rather than by length,
    // so the tip is exactly at a node at the moment that node lands rather
    // than drifting a diagonal's worth further behind at every promotion.
    if (historyBody && trackLine && marker) {
      const reels = [...marker.querySelectorAll<HTMLElement>('[data-reel]')];
      const yearBox = marker.querySelector<HTMLElement>('[data-marker-year]');
      let shownYear = -1;

      // Each reel rests on a CSS transform naming its digit, which GSAP would
      // otherwise read as a pixel offset and stack its own on top of. Normalise
      // them to the same terms the rolls are written in, once, up front.
      reels.forEach((reel) => {
        const digit = Number(reel.style.getPropertyValue('--d')) || 0;
        reel.dataset.at = String(digit);
        gsap.set(reel, { yPercent: -10 * digit, y: 0 });
      });
      restores.push(() => {
        trackLine.style.strokeDasharray = '';
        trackLine.style.strokeDashoffset = '';
      });

      // Only the digits that actually changed turn, so a year climbing by one
      // moves one reel rather than flickering all four.
      const rollTo = (year: number) => {
        if (year === shownYear) return;
        shownYear = year;
        const digits = String(year).padStart(reels.length, '0').slice(-reels.length);
        reels.forEach((reel, index) => {
          const digit = Number(digits[index]);
          if (reel.dataset.at === String(digit)) return;
          reel.dataset.at = String(digit);
          gsap.to(reel, {
            yPercent: -10 * digit,
            duration: 0.42,
            ease: 'power3.out',
            overwrite: true,
          });
        });
        if (yearBox) {
          gsap.fromTo(
            yearBox,
            { scale: 1.14 },
            { scale: 1, duration: 0.5, ease: 'power3.out', overwrite: 'auto' },
          );
        }
      };

      const drawTo = (progress: number) => {
        if (vertices.length < 2 || !lineLength) return;
        const top = vertices[0].y;
        const y = top + (vertices[vertices.length - 1].y - top) * progress;
        const tip = pointAt(y);

        trackLine.style.strokeDasharray = String(lineLength);
        trackLine.style.strokeDashoffset = String(lineLength - tip.at);
        rollTo(Math.round(yearAt(y)));

        // Where the line dissolves into a word, so does its tip: a copper dot
        // and a year sitting on top of the letters is the thing the fade is
        // there to avoid. Same ramp as the mask uses, so the two go together.
        let veiled = 0;
        crossings.forEach((crossing) => {
          veiled = Math.max(
            veiled,
            Math.min(
              gsap.utils.clamp(0, 1, (y - crossing.top + CROSS_FADE) / CROSS_FADE),
              gsap.utils.clamp(0, 1, (crossing.bottom + CROSS_FADE - y) / CROSS_FADE),
            ),
          );
        });

        // On at the very top of the line, and off again over the run past the
        // last stop — the same distance the track's mask fades the line out
        // over, so the two go together.
        const trail = lineLength - lastStopAt;
        gsap.set(marker, {
          x: tip.x,
          y: tip.y,
          opacity:
            Math.min(
              gsap.utils.clamp(0, 1, tip.at / 30),
              trail > 0 ? gsap.utils.clamp(0, 1, (lineLength - tip.at) / trail) : 1,
            ) *
            (1 - veiled),
        });
      };

      const head = { at: 0 };
      gsap.fromTo(
        head,
        { at: 0 },
        {
          at: 1,
          ease: 'none',
          onUpdate: () => drawTo(head.at),
          scrollTrigger: {
            trigger: historyBody,
            start: () => `top+=${vertices[0]?.y ?? 0} 76%`,
            end: () => `top+=${vertices[vertices.length - 1]?.y ?? 0} 76%`,
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    }

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
          // A pointer screen reads faster than it scrolls, so the detail is
          // done a third of the way sooner there: twenty points of travel
          // rather than thirty, off the same start. Evaluated on refresh, so
          // dragging a window across the breakpoint re-measures.
          end: () =>
            window.matchMedia('(min-width: 761px)').matches ? 'top 56%' : 'top 46%',
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

    // The co-op terms are dealt onto the page rather than faded in, tilting up
    // off their own top edge one after another.
    q('.coop-strip').forEach((strip) => {
      const cards = strip.querySelectorAll<HTMLElement>('[data-coop-term]');
      if (!cards.length) return;
      gsap.fromTo(
        cards,
        { opacity: 0, y: 30, rotateX: -42, transformOrigin: 'top center' },
        {
          opacity: 1,
          y: 0,
          rotateX: 0,
          ease: 'power2.out',
          stagger: 0.14,
          scrollTrigger: {
            trigger: strip,
            start: 'top 94%',
            end: 'bottom 72%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    // The crest builds a layer at a time: the shape turns in, the chevrons run
    // down behind it, and the lions land last. It is the only mark that is
    // taken apart like this — the other two are the companies' own logos,
    // shipped as images, and they arrive with the rest of the row.
    const crest = page.querySelector<HTMLElement>('[data-org-mark="uwaterloo"]');
    if (crest) {
      const layer = (name: string) =>
        crest.querySelector<SVGGElement>(`[data-mark-layer="${name}"]`);
      const lions = layer('lions')?.children;
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: crest.closest<HTMLElement>('[data-tenure]') ?? crest,
          start: 'top 88%',
          end: 'top 54%',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      timeline.fromTo(
        crest,
        { opacity: 0, scale: 0.66, rotate: -10 },
        { opacity: 1, scale: 1, rotate: 0, duration: 1, ease: 'back.out(1.6)' },
        0,
      );
      const lines = layer('lines');
      if (lines) {
        timeline.fromTo(
          lines,
          { yPercent: -45, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 0.7, ease: 'power2.out' },
          0.45,
        );
      }
      if (lions?.length) {
        timeline.fromTo(
          lions,
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.5, stagger: 0.014, ease: 'back.out(2.2)' },
          0.6,
        );
      }
    }

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
      stopMarquee?.();
      splits.forEach((split) => split.revert());
      restores.forEach((restore) => restore());
    };
  });

  // ── Wide pointer screens only ──
  //
  // The archive is a real horizontal scroller everywhere; here the page pins
  // it and drives the track from vertical scroll instead, which is only worth
  // taking a swipe away for on a screen with room for it.
  media.add(
    '(min-width: 761px) and (min-height: 720px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    () => {
      const stage = page.querySelector<HTMLElement>('[data-archive-stage]');
      const gallery = page.querySelector<HTMLElement>('[data-gallery]');
      const track = page.querySelector<HTMLElement>('[data-gallery-track]');
      if (!stage || !gallery || !track) return;

      gallery.classList.add('is-pinned');
      const travel = () => Math.max(0, track.scrollWidth - gallery.clientWidth);

      gsap.to(track, {
        x: () => -travel(),
        ease: 'none',
        scrollTrigger: {
          // The whole stage holds still, heading included.
          trigger: stage,
          start: 'center center',
          // Exactly as long as there is strip left to move: any more and the
          // section sits there pinned with nothing happening.
          end: () => `+=${travel()}`,
          pin: stage,
          // No lag. With one, the strip was still sliding sideways after the
          // pin had let go and the section was scrolling away underneath it.
          scrub: true,
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
        // Already at the top: nothing to scroll, so the tile leans and says so.
        if (home.hasAttribute('data-here')) return;
        (event as MouseEvent & { pageHandled?: boolean }).pageHandled = true;
        scrollTo(0, false);
        return;
      }

      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (!link || (link.target && link.target !== '_self')) return;

      const hash = hashFor(link);
      if (!hash) return;

      event.preventDefault();
      // Already reading the section this points at — same as the house tile at
      // the top of the page, it leans and says so rather than scrolling.
      if (link.hasAttribute('data-here')) return;
      (event as MouseEvent & { pageHandled?: boolean }).pageHandled = true;
      history.replaceState(history.state, '', hash);
      scrollToTarget(hash, false);
    },
    { capture: true, signal },
  );

  // A nav tile is "here" when clicking it would not move the page. That single
  // fact drives everything: the label it shows, whether a tap pops that label
  // open, and whether the tile leans instead of scrolling. The label itself is
  // always present, so hovering on a desktop still says what the icon does.
  const brandTile = document.querySelector<HTMLElement>('.top-nav [data-scroll-top]');
  const aboutTile = document.querySelector<HTMLElement>('.top-nav .about-link');
  const aboutSection = document.getElementById('about');

  const syncTiles = () => {
    if (brandTile) {
      const atTop = window.scrollY <= 4;
      brandTile.toggleAttribute('data-here', atTop);
      brandTile.dataset.tooltip = atTop ? "You're home" : 'Back to top';
    }

    if (aboutTile && aboutSection) {
      // Reading the section counts as being there, rather than only the exact
      // scroll position a click would land on.
      const bounds = aboutSection.getBoundingClientRect();
      const middle = window.innerHeight / 2;
      const here = bounds.top <= middle && bounds.bottom >= middle;
      aboutTile.toggleAttribute('data-here', here);
      aboutTile.dataset.tooltip = here ? "It's me" : 'About me';
    }
  };

  syncTiles();
  window.addEventListener('scroll', syncTiles, { passive: true, signal });
  window.addEventListener('resize', syncTiles, { passive: true, signal });

  ScrollTrigger.refresh();
  // Arriving from another page with /#about in the URL should land on the
  // chapter, not at the top of the document.
  if (location.hash.length > 1) scrollToTarget(location.hash, true);

  cleanupActivePage = () => {
    controller.abort();
    ScrollTrigger.removeEventListener('refreshInit', remeasure);
    media.revert();
    cleanupActivePage = () => {};
  };
}

document.addEventListener('astro:before-swap', () => cleanupActivePage());
document.addEventListener('astro:page-load', setupPage);

if (document.readyState === 'complete') setupPage();
