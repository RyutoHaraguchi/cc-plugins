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
  await page.evaluate(() => { window.__cy.getElementById(window.__graphTargetId).emit('tap'); });
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
  await page.evaluate(() => { window.__cy.emit('tap'); });
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length === 0);
});

test('⑦経路ハイライトをプレースホルダへ戻すと減光が解除される(回帰: 26aac5c)', async ({ page }) => {
  // 26aac5c 以前は onEntrySelectChange() が val 空文字(プレースホルダ)のとき render() を呼ばずに
  // 早期 return しており、dimFocus = null が .dimmed の除去に反映されなかった
  // (dimFocus===null なら何もしない applyDim() は render() 内でしか呼ばれないため)。
  // 「タップ→実エントリ選択→再タップ→プレースホルダへ戻す」で再現する。
  // このテストは onEntrySelectChange() 先頭の dimFocus = null; 直後にある applyDim() 呼び出しが
  // 無いと、最後の waitForFunction がタイムアウトして FAIL する(手元で当該行を一時的にコメント
  // アウトして確認済み)。
  await page.goto(generate('callback', 'itemHandler'));
  const optionCount = await page.evaluate(
    () => document.getElementById('entry-select').options.length,
  );
  expect(optionCount).toBeGreaterThan(1); // index 0 はプレースホルダ、index 1 以降が実エントリ

  // 全展開して非近傍ノードを作る(初期表示のままだと target の近傍だけで .dimmed 対象がない)
  await page.click('#expand-all');
  await page.waitForFunction(() =>
    window.__cy.nodes().some((n) => n.data('label')?.includes('boot')),
  );

  // target をタップして減光させる
  await page.evaluate(() => { window.__cy.getElementById(window.__graphTargetId).emit('tap'); });
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length > 0);

  // 実エントリを選択 → render() 経由で減光が解除される
  await page.selectOption('#entry-select', { index: 1 });
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length === 0);

  // 再度タップして dimFocus を設定し直す(経路ハイライトが選択された状態で減光が有効になる)
  await page.evaluate(() => { window.__cy.getElementById(window.__graphTargetId).emit('tap'); });
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length > 0);

  // プレースホルダ(空文字)へ戻す → 減光も解除されるべき
  await page.selectOption('#entry-select', { index: 0 });
  await page.waitForFunction(() => window.__cy.elements('.dimmed').length === 0);
});

test('⑧トグルボタンで詳細パネルが開閉できる', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#detail-toggle')).toHaveText('▶');
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-label', '詳細パネルを閉じる');
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#detail-toggle')).toHaveText('◀');
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-label', '詳細パネルを開く');
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail-toggle')).toHaveText('▶');
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-label', '詳細パネルを閉じる');
});

test('⑨閉じた状態でノードをタップするとパネルが自動で開く', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeHidden();
  await page.evaluate(() => { window.__cy.getElementById(window.__graphTargetId).emit('tap'); });
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail .detail-name')).not.toBeEmpty();
});

test('⑩ディバイダのドラッグでパネル幅が変わる', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  const before = await page.locator('#detail').evaluate((el) => el.getBoundingClientRect().width);
  const box = await page.locator('#divider').boundingBox();
  // トグルボタン(20x48, ディバイダ中央に絶対配置)がディバイダ中心を覆っているため、
  // 中心を掴むとボタンの pointerdown/click になりドラッグが始まらない。上端付近を掴む。
  const startX = box.x + box.width / 2;
  const startY = box.y + 10;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 120, startY, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('#detail').evaluate((el) => el.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before + 60);
});

test('⑪経路ハイライト中にノードをタップしても経路上ノードは減光されない', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  // boot をエントリに選択(boot → setupRoutes → itemHandler の経路がハイライトされる)
  const bootValue = await page.evaluate(() => {
    const sel = document.getElementById('entry-select');
    return [...sel.options].find((o) => o.textContent.includes('boot'))?.value;
  });
  expect(bootValue).toBeTruthy();
  await page.selectOption('#entry-select', bootValue);
  await page.waitForFunction(() => window.__cy.edges('.on-path').length > 0);

  // target(itemHandler)をタップ → 経路上だが 2 ホップ先の boot が減光されてはならない
  // (明るい経路が暗いノードを貫く見た目になる)
  await page.evaluate(() => { window.__cy.getElementById(window.__graphTargetId).emit('tap'); });
  const onPathDimmed = await page.evaluate(() =>
    window.__cy.edges('.on-path').connectedNodes().some((n) => n.hasClass('dimmed')),
  );
  expect(onPathDimmed).toBeFalsy();
});

test('⑫ディバイダの掴み位置によらずドラッグ開始でパネル幅がジャンプしない', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  const before = await page.locator('#detail').evaluate((el) => el.getBoundingClientRect().width);
  const box = await page.locator('#divider').boundingBox();
  // ディバイダの左端(パネル左端から最も遠い位置)を掴んで 2px だけ動かす。
  // 掴みオフセット未補正だとディバイダ幅ぶん(約 8px)のジャンプが乗る。
  const startX = box.x + 1;
  const startY = box.y + 10;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 2, startY, { steps: 2 });
  await page.mouse.up();
  const after = await page.locator('#detail').evaluate((el) => el.getBoundingClientRect().width);
  expect(after - before).toBeLessThan(5);
  expect(after - before).toBeGreaterThanOrEqual(0);
});

test('⑬閉状態のディバイダに col-resize カーソルが残らない', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  const openCursor = await page.locator('#divider').evaluate((el) => getComputedStyle(el).cursor);
  expect(openCursor).toBe('col-resize');
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeHidden();
  const closedCursor = await page.locator('#divider').evaluate((el) => getComputedStyle(el).cursor);
  expect(closedCursor).not.toBe('col-resize');
});

test('⑭参照グラフモード: variable ノードと reads エッジが描画されモードバナーが出る', async ({ page }) => {
  await page.goto(generate('reference-graph', 'SETTINGS'));
  await expect(page.locator('#graph canvas').first()).toBeVisible();
  const targetKind = await page.evaluate(() =>
    window.__cy.getElementById(window.__graphTargetId).data('kind'),
  );
  expect(targetKind).toBe('variable');
  const readsEdges = await page.evaluate(() => window.__cy.edges('.reads').length);
  expect(readsEdges).toBeGreaterThan(0);
  await expect(page.locator('#banner .mode-line')).toContainText('参照グラフモード');
});
