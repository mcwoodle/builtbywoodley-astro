import { expect, test } from '@playwright/test';

/**
 * Three modes, not two: System (the default) resolves against the OS setting,
 * while Light and Dark pin it. `data-theme-mode` is the choice and `data-theme`
 * is what that choice resolved to — the toggle and the no-flash init in
 * BaseLayout's <head> have to agree about both.
 */
test.describe('theme toggle', () => {
  const html = 'html';

  test('cycles system to light to dark and back', async ({ page }) => {
    await page.goto('/');

    const root = page.locator(html);
    await expect(root).toHaveAttribute('data-theme-mode', 'system');

    const toggle = page.locator('footer.site-footer .theme-toggle');

    await toggle.click();
    await expect(root).toHaveAttribute('data-theme-mode', 'light');
    await expect(root).toHaveAttribute('data-theme', 'light');

    await toggle.click();
    await expect(root).toHaveAttribute('data-theme-mode', 'dark');
    await expect(root).toHaveAttribute('data-theme', 'dark');

    await toggle.click();
    await expect(root).toHaveAttribute('data-theme-mode', 'system');
    // Back on automatic, so the resolved theme follows the emulated OS setting
    // rather than the last press — assert only that it resolved to something.
    await expect(root).toHaveAttribute('data-theme', /^(light|dark)$/);
  });

  test('remembers an explicit choice across a reload', async ({ page }) => {
    await page.goto('/');

    const root = page.locator(html);
    const toggle = page.locator('footer.site-footer .theme-toggle');

    await toggle.click(); // light
    await toggle.click(); // dark
    await expect(root).toHaveAttribute('data-theme-mode', 'dark');

    await page.reload();

    // This is the head script's path, not the toggle's: it has to read
    // localStorage and paint the right theme before anything else runs.
    await expect(root).toHaveAttribute('data-theme-mode', 'dark');
    await expect(root).toHaveAttribute('data-theme', 'dark');
  });
});
