import { expect, test } from '@playwright/test';

/**
 * The landing page is the one route that runs the whole client-side story —
 * the GSAP intro, the marquee, the pinned gallery — so "it rendered and nothing
 * threw" is a genuinely load-bearing assertion here rather than a formality.
 */
test.describe('landing page', () => {
  test('renders its chrome and hero without throwing', async ({ page }) => {
    // Uncaught exceptions and same-origin requests that 404. Deliberately NOT
    // console messages: Google Fonts and WebKit both emit benign noise there,
    // and a smoke test that cries wolf gets ignored.
    const pageErrors: string[] = [];
    const badResponses: string[] = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const url = new URL(response.url());
      const origin = new URL(page.url() || 'http://localhost').origin;
      if (url.origin !== origin) return;
      if (response.status() >= 400) {
        badResponses.push(`${response.status()} ${url.pathname}`);
      }
    });

    await page.goto('/');

    const title = page.locator('h1#landing-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Woodley');

    await expect(page.locator('header.top-nav')).toBeVisible();
    await expect(page.locator('footer.site-footer')).toBeVisible();

    // The showcase image is loading="eager" fetchpriority="high", so it is part
    // of the first paint. naturalWidth proves the ladder resolved to a real
    // file rather than just proving an <img> tag was emitted.
    const showcase = page.locator('.showcase-image');
    await expect(showcase).toBeVisible();
    await expect
      .poll(() => showcase.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(badResponses, 'same-origin requests that failed').toEqual([]);
  });

  test('reaches the chapters below the fold', async ({ page }) => {
    await page.goto('/');

    // Under reduced motion the reveal timelines never run, so these are plain
    // static content. If this test starts failing, the first thing to check is
    // whether a new animation forgot its no-preference guard.
    await expect(page.locator('#about')).toBeAttached();
    await expect(page.locator('#work')).toBeAttached();
    await expect(page.locator('#archive')).toBeAttached();

    const workCards = page.locator('.work-card');
    await expect(workCards.first()).toBeVisible();
    expect(await workCards.count()).toBeGreaterThan(0);
  });
});
