import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..');

function generate(fixture, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-smoke-'));
  const g = path.join(dir, 'g.json');
  const html = path.join(dir, 'v.html');
  execFileSync('node', [
    path.join(scripts, 'analyze-callgraph.mjs'),
    '--project',
    path.join(here, 'fixtures', fixture),
    '--function',
    fn,
    '--out',
    g,
  ]);
  execFileSync('node', [path.join(scripts, 'generate-html.mjs'), '--graph', g, '--out', html]);
  return 'file://' + html;
}

test('①エラーなくロードされグラフが描画される', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(generate('callback', 'itemHandler'));
  await expect(page.locator('#graph canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('②展開操作で表示ノード数が増える', async ({ page }) => {
  // callback fixture は boot が距離2にあるため、初期表示(±1ホップ)には含まれない。
  // よって全展開すれば必ずノード数が増える(決定的なアサーション)。
  await page.goto(generate('callback', 'itemHandler'));
  const before = await page.evaluate(() => window.__cy.nodes().length);
  await page.click('#expand-all');
  const after = await page.evaluate(() => window.__cy.nodes().length);
  expect(after).toBeGreaterThan(before);
  const bootVisible = await page.evaluate(() =>
    window.__cy
      .nodes()
      .some((n) => n.data('label')?.includes('boot') || n.data('id').includes('main.ts')),
  );
  expect(bootVisible).toBeTruthy();
});

test('③検索でノードにフォーカスする', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await page.fill('#search', 'boot');
  await page.waitForTimeout(300);
  const hit = await page.evaluate(() => window.__cy.$('.search-hit').length);
  expect(hit).toBeGreaterThan(0);
});

test('④XSS fixture のコードが実行されない', async ({ page }) => {
  await page.goto(generate('xss', 'renderPage'));
  await page.evaluate(() => window.__showDetail(window.__graphTargetId)); // コードを詳細パネルに表示させる
  const executed = await page.evaluate(() => window.__xss_executed);
  expect(executed).toBeUndefined();
});
