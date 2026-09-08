import { expect, test } from '@playwright/test';

/**
 * Navigation runs through Astro's ClientRouter, which swaps the document rather
 * than reloading it. That makes it the most breakable thing on the site — a
 * script that assumes it owns the page for its whole lifetime works on a first
 * load and dies on the second. Every hop below is a real click, not a goto.
 */
test.describe('navigation', () => {
  test('moves between the three top-level routes and back home', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Primary navigation' });

    await nav.getByRole('link', { name: 'Software', exact: true }).click();
    await expect(page).toHaveURL(/\/software\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Software projects');
    await expect(page.locator('.portfolio-card').first()).toBeVisible();

    await nav.getByRole('link', { name: 'Photography', exact: true }).click();
    await expect(page).toHaveURL(/\/photography\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Shots taken');
    await expect(page.locator('.photo-tile').first()).toBeVisible();

    // The house glyph. Its accessible name changes with where you are, which is
    // why this matches on the class rather than the label.
    await page.locator('.top-nav .brand-link').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('h1#landing-title')).toBeVisible();
  });

  test('opens a software case study from the index', async ({ page }) => {
    await page.goto('/software');

    // The href^= guard is not cosmetic: a software entry can set `cardUrl` to
    // send its card somewhere else entirely (gta-urban-analytics points at
    // /viz/), and that is not the case-study page this test is about.
    const card = page.locator('.portfolio-card[href^="/software/"]').first();
    await expect(card).toBeVisible();
    await card.click();

    await expect(page).toHaveURL(/\/software\/[^/]+\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // TopNav grows a breadcrumb once you are below /software/ — but only where
    // there is room for it. global.css hides it under 720px, which covers both
    // mobile projects, so asserting it there would be asserting against the
    // design rather than against a regression. Check the branch that applies.
    const breadcrumb = page.locator('.top-nav .breadcrumb');
    if ((page.viewportSize()?.width ?? 0) > 720) {
      await expect(breadcrumb.getByRole('link', { name: 'Software Projects' })).toBeVisible();
    } else {
      await expect(breadcrumb).toBeHidden();
    }
  });

  test('honours the /about redirect onto the landing page chapter', async ({ page }) => {
    await page.goto('/about');

    await expect(page).toHaveURL(/\/#about$/);
    await expect(page.locator('#about')).toBeAttached();
    await expect(page.locator('h1#landing-title')).toBeAttached();
  });
});
