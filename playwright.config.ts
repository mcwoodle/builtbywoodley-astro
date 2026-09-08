import { defineConfig, devices } from '@playwright/test';

// astro preview's default port. Only used when nothing external was named.
// `localhost`, not `127.0.0.1`: astro preview binds the loopback name, which on
// a dual-stack machine resolves to ::1 and leaves the IPv4 literal unanswered.
const LOCAL_URL = 'http://localhost:4321';

// SMOKE_BASE_URL points the whole suite at a deployed origin — the Cloudflare
// preview URL in CI, production, or a dev server already running locally.
// Unset (or empty, which is what a skipped preview job hands us) falls back to
// building and serving the site here.
const target = process.env.SMOKE_BASE_URL?.replace(/\/+$/, '') || '';
const baseURL = target || LOCAL_URL;

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  // A stray test.only would silently shrink the suite that gates a merge.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL,

    // Load-bearing, not a courtesy. Every GSAP timeline in home-scroll.ts sits
    // inside media.add('(prefers-reduced-motion: no-preference)'), smooth-scroll.ts
    // drops Lenis to duration 0 under `reduce`, and global.css undoes the
    // data-motion-armed resting states. Asking for stillness is what makes the
    // page render as static content that can be asserted on at all.
    reducedMotion: 'reduce',

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Two desktop widths' worth of engines plus the two form factors the site's
  // breakpoints actually branch on. Playwright's WebKit is Safari's engine, so
  // it catches <dialog>, view-transition and `sizes` parsing differences — but
  // it is not literally Safari, and will not show macOS font metrics.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],

  // Skipped entirely when SMOKE_BASE_URL named a target. The build processes the
  // full image ladders, so it needs considerably longer than the default 60s.
  webServer: target
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --ignore-lock --port 4321',
        url: LOCAL_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: {
          // astro preview daemonizes itself when it detects a coding agent in
          // the environment, so Playwright would be left watching a process
          // that exits before it ever serves. This variable is the documented
          // opt-out — it is the marker astro sets on the child it spawns for
          // --background, and it turns the auto-detection off. Its only other
          // effect is a `background: true` field in the lock file, which never
          // gets written here because --ignore-lock skips the lock entirely.
          ASTRO_PREVIEW_BACKGROUND: '1',
        },
      },
});
