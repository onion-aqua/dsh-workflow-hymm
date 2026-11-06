import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const screenshots = resolve(process.cwd(), '../../outputs/previews/reasoning-slider');

test('reference style supports click, drag, and native keyboard controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const slider = page.getByRole('slider', { name: '思考程度' });
  await expect(slider).toHaveValue('2');
  await expect(page.getByTestId('reasoning-slider-stop')).toHaveCount(5);
  await page.screenshot({ path: resolve(screenshots, 'preview.png') });
  await page.getByTestId('reasoning-slider').screenshot({ path: resolve(screenshots, 'slider.png') });

  await slider.focus();
  await slider.press('Home');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '中 · medium');
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '最高 · max');
  const fill = page.locator('.wf-reasoning-fill');
  await expect(fill).toHaveCSS('animation-name', 'wf-reasoning-aurora');
  const position = await fill.evaluate(element => getComputedStyle(element).backgroundPosition);
  await expect.poll(() => fill.evaluate(element => getComputedStyle(element).backgroundPosition)).not.toBe(position);
  await expect(page.locator('.wf-reasoning-sparks > span')).toHaveCount(16);
  await page.mouse.move(0, 0);
  await slider.blur();
  await expect(page.getByTestId('reasoning-slider-tooltip')).toHaveCSS('opacity', '0');
  await page.getByTestId('reasoning-slider').screenshot({ path: resolve(screenshots, 'slider-purple.png') });
  await slider.press('ArrowLeft');
  await expect(fill).toHaveCSS('background-color', 'rgb(50, 152, 255)');
  await expect(page.locator('.wf-reasoning-sparks')).toHaveCount(0);
  await slider.blur();
  await expect(page.getByTestId('reasoning-slider-tooltip')).toHaveCSS('opacity', '0');
  await page.getByTestId('reasoning-slider').screenshot({ path: resolve(screenshots, 'slider-blue.png') });
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(slider).toHaveValue('2');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 17, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuetext', '最高 · max');
  await expect(page.getByTestId('preview-value')).toContainText('max');
  await expect(page.getByTestId('reasoning-slider-tooltip')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('model examples retain real stop counts, switch semantics, and unavailable states', async ({ page }) => {
  await page.goto('/');
  const choose = async (name: string) => {
    await page.getByRole('button', { name: /^选择模型：/ }).click();
    await page.getByRole('dialog', { name: '切换模型示例' }).getByRole('button', { name: new RegExp(name) }).click();
  };
  const slider = page.getByRole('slider');
  for (const [name, count] of [['DeepSeek Flash', 3], ['Grok 4.7', 4], ['5.6 Terra', 6], ['Claude Opus 5.5', 5], ['Kimi K2.6', 2]] as const) {
    await choose(name);
    await expect(page.getByTestId('reasoning-slider-stop')).toHaveCount(count);
    await expect(slider).toHaveAttribute('max', String(count - 1));
    await expect(slider).toBeEnabled();
  }
  await expect(slider).toHaveAccessibleName('思考模式');
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '关闭 · disabled');
  await choose('Qwen3.8 Max');
  await expect(slider).toBeDisabled();
  await expect(slider).toHaveAttribute('aria-valuetext', /Token 预算/);
  await expect(page.getByTestId('reasoning-slider-stop')).toHaveCount(0);
  await choose('自定义模型');
  await expect(slider).toBeDisabled();
  await expect(page.getByTestId('reasoning-slider')).toHaveAttribute('data-state', 'unknown');
  await choose('6.1 Sol');
  await expect(slider).toBeEnabled();
});

test('narrow layout and reduced motion preserve the reference control', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 620 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const slider = page.getByRole('slider');
  const box = (await slider.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(280);
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '最高 · max');
  await expect(page.getByTestId('reasoning-slider-tooltip')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.wf-reasoning-fill')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.wf-reasoning-sparks > span').first()).toHaveCSS('animation-name', 'none');
  await page.mouse.move(0, 0);
  await slider.blur();
  await page.screenshot({ path: resolve(screenshots, 'preview-narrow.png') });
  await page.getByRole('button', { name: /^选择模型：/ }).click();
  const menu = page.getByRole('dialog', { name: '切换模型示例' });
  await expect(menu).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
