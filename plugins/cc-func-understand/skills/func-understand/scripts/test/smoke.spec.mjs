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
  // render() は同期的だが、フレーク耐性のため条件ベースで待つ(タイムアウト待ちにしない)。
  await page.waitForFunction((n) => window.__cy.nodes().length > n, before);
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
  await page.waitForFunction(() => window.__cy.$('.search-hit').length > 0);
  const hit = await page.evaluate(() => window.__cy.$('.search-hit').length);
  expect(hit).toBeGreaterThan(0);
});

test('④XSS fixture のコードが実行されない', async ({ page }) => {
  await page.goto(generate('xss', 'renderPage'));
  await page.evaluate(() => window.__showDetail(window.__graphTargetId)); // コードを詳細パネルに表示させる
  // showDetail が早期リターンした場合(id 解決失敗など)でも __xss_executed は
  // 自明に undefined になり検証を素通りしてしまうため、まず「注入ベクターを含む
  // コードが実際に詳細パネルへ描画された」ことを正のアサーションで確認してから
  // 実行されていないことを確認する。
  await expect(page.locator('#detail pre code')).toContainText('__xss_executed');
  const executed = await page.evaluate(() => window.__xss_executed);
  expect(executed).toBeUndefined();
});

test('⑤エッジが taxi ルーティングで描画される', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await expect(page.locator('#graph canvas').first()).toBeVisible();
  const curveStyle = await page.evaluate(() => window.__cy.edges().first().style('curve-style'));
  expect(curveStyle).toBe('taxi');
});

test('⑥ノードタップで非近傍が減光され、背景タップで解除される', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  // boot(距離2)を表示させ、非近傍ノードを作る
  await page.click('#expand-all');
  await page.waitForFunction(() =>
    window.__cy.nodes().some((n) => n.data('label')?.includes('boot')),
  );
  // 初期状態では減光なし(programmatic な showDetail では発動しない)
  expect(await page.evaluate(() => window.__cy.elements('.dimmed').length)).toBe(0);

  // target をタップ → 2ホップ先の boot は減光、近傍は減光されない
  await page.evaluate(() => window.__cy.getElementById(window.__graphTargetId).emit('tap'));
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length > 0);
  const bootDimmed = await page.evaluate(() =>
    window.__cy
      .nodes()
      .filter((n) => n.data('label')?.includes('boot'))
      .every((n) => n.hasClass('dimmed')),
  );
  expect(bootDimmed).toBeTruthy();
  const neighborhoodDimmed = await page.evaluate(() =>
    window.__cy
      .getElementById(window.__graphTargetId)
      .closedNeighborhood()
      .some((el) => el.hasClass('dimmed')),
  );
  expect(neighborhoodDimmed).toBeFalsy();

  // 背景タップで全解除
  await page.evaluate(() => window.__cy.emit('tap'));
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length === 0);
});
