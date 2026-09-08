import { expect, test } from '@playwright/test';

/**
 * The photo viewer keeps its open frame in location.hash rather than in
 * component state, which is what makes Back close it and a shared link open it.
 * That design only pays off if the URL and the panel actually stay in step, so
 * that is what these tests check — the panel opening is almost incidental.
 */
test.describe('photo viewer', () => {
  test('opens from a tile, steps between frames, and closes', async ({ page }) => {
    await page.goto('/photography');

    const tiles = page.locator('.photo-tile');
    await expect(tiles.first()).toBeVisible();

    const dialog = page.locator('dialog.photo-viewer');
    const viewerTitle = page.locator('[data-photo-title]');

    await tiles.first().locator('.photo-tile-link').click();

    // showModal() puts it in the top layer; `open` is the honest signal.
    await expect(dialog).toHaveAttribute('open', '');
    await expect(viewerTitle).not.toBeEmpty();
    await expect(page).toHaveURL(/#.+$/);

    const firstTitle = await viewerTitle.textContent();

    // The step glides the current frame out before swapping, so the assertion
    // has to be the retrying kind rather than a read straight after the click.
    await page.locator('[data-photo-step="1"]').click();
    await expect(viewerTitle).not.toHaveText(firstTitle ?? '');

    // Escape unwinds one layer; with no zoom open that is the panel itself,
    // and it goes back through history so the hash goes with it.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(page).toHaveURL(/\/photography\/?$/);
  });

  test('opens straight from a shared link', async ({ page }) => {
    await page.goto('/photography');

    // Each tile carries its own anchor as an id — that is the shareable URL.
    const anchor = await page.locator('.photo-tile').first().getAttribute('id');
    expect(anchor).toBeTruthy();

    await page.goto(`/photography#${anchor}`);

    await expect(page.locator('dialog.photo-viewer')).toHaveAttribute('open', '');
    await expect(page.locator('[data-photo-title]')).not.toBeEmpty();
  });
});
