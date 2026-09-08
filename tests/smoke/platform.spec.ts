import { expect, test } from '@playwright/test';
import { isEdgeTarget } from '../support/target';

const ROUTES = ['/', '/software', '/photography'];

/**
 * What the site does at the edges: the wrong URL, the narrow screen, and the
 * headers Cloudflare is supposed to be putting on every response.
 */
test.describe('platform', () => {
  test('serves the 404 page for an unknown path', async ({ page }) => {
    const response = await page.goto('/no-such-page-exists');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'This page took a different route',
    );
    await expect(page.getByRole('link', { name: /Return home/ })).toBeVisible();
  });

  // The reason the mobile projects are in the matrix at all. The site's layout
  // is driven by hand-written breakpoints and `sizes` attributes that mirror
  // them, so a mismatch shows up as the page being wider than the phone.
  for (const route of ROUTES) {
    test(`does not scroll sideways on ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
      });

      // The marquee track is deliberately wider than the viewport, but it lives
      // inside an overflow:hidden parent and so must not reach the document.
      expect(
        overflow.scrollWidth,
        `${route} overflows by ${overflow.scrollWidth - overflow.clientWidth}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }

  test('serves its security headers', async ({ request }) => {
    // public/_headers is a Cloudflare directive. astro preview copies the file
    // into dist/ and serves it as an asset without ever applying it, so this
    // can only be checked against a deployed origin.
    test.skip(!isEdgeTarget, 'needs a deployed origin — set SMOKE_BASE_URL');

    const response = await request.get('/');
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBeTruthy();
    expect(headers['referrer-policy']).toBeTruthy();
  });
});
