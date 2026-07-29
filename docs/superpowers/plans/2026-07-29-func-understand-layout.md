# func-understand グラフレイアウト整理(#6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビューアのグラフを「綺麗に並んでいる」状態に近づける — dagre オプション調整(align: DL + nodeSep: 20)、taxi エッジルーティング、選択時デクラッタ(近傍フォーカス)の 3 点を実装する。

**Architecture:** 変更はすべて自己完結 HTML ビューアのテンプレート `templates/viewer.js` 内で完結する(解析エンジン・HTML 生成は不変、ライブラリ追加なし)。cytoscape 要素のスタイルは CSS でなく `CY_STYLE` 配列で定義されている点に注意。検証は Playwright スモークテスト(`scripts/test/smoke.spec.mjs`)。

**Tech Stack:** cytoscape 3.30.4 + cytoscape-dagre 2.5.0(埋込済み)、@playwright/test 1.61.1

**Spec:** `docs/superpowers/specs/2026-07-29-func-understand-layout-design.md`

## Global Constraints

- 作業ブランチ: `feat/func-understand-layout`(作成済み)
- ライブラリの追加・更新は行わない(自己完結 HTML のサイズ増ゼロ)
- 解析エンジン(`analyze-callgraph.mjs` / `lib/`)と `generate-html.mjs` は変更しない
- スモークテスト実行コマンド: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs`
- 以降のパスは `plugins/cc-func-understand/skills/func-understand/` からの相対で表記する

---

### Task 1: レイアウトオプション変更と taxi ルーティング

**Files:**
- Modify: `templates/viewer.js`(`CY_STYLE` の edge スタイル、`render()` のレイアウト呼び出し)
- Test: `scripts/test/smoke.spec.mjs`

**Interfaces:**
- Consumes: 既存のテストフック `window.__cy`(viewer.js 末尾で公開済み)
- Produces: edge の computed style `curve-style` が `'taxi'` になる(Task 2 のテストは本タスクの見た目変更に依存しない)

- [ ] **Step 1: 失敗するテストを書く**

`scripts/test/smoke.spec.mjs` の末尾に追加:

```js
test('⑤エッジが taxi ルーティングで描画される', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await expect(page.locator('#graph canvas').first()).toBeVisible();
  const curveStyle = await page.evaluate(() => window.__cy.edges().first().style('curve-style'));
  expect(curveStyle).toBe('taxi');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs`
Expected: ⑤ が FAIL(`Expected: "taxi"` / `Received: "bezier"`)、①〜④ は PASS

- [ ] **Step 3: viewer.js を変更する**

`templates/viewer.js` の `CY_STYLE` 内 edge スタイル(150〜160 行付近)を変更:

```js
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#484f58',
      'target-arrow-color': '#484f58',
      'target-arrow-shape': 'triangle',
      'curve-style': 'taxi',
      'font-size': 9,
      color: '#8b949e',
    },
  },
```

`render()`(198 行付近)のレイアウト呼び出しを変更:

```js
  cy.layout({ name: 'dagre', rankDir: 'LR', align: 'DL', nodeSep: 20, nodeDimensionsIncludeLabels: true, padding: 30 }).run();
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs`
Expected: ①〜⑤ すべて PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/templates/viewer.js plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs
git commit -m "feat(cc-func-understand): dagre を align:DL + nodeSep:20 に調整し taxi ルーティングへ変更

実グラフ(112ノード/161エッジ)の実測で初期表示の交差 -38%・面積 -36% を確認。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 選択時デクラッタ(近傍フォーカス)

**Files:**
- Modify: `templates/viewer.js`(`CY_STYLE` に dimmed スタイル追加、状態 `dimFocus` と `applyDim()` の追加、`initCy()` のタップハンドラ、`render()`、`onEntrySelectChange()`)
- Test: `scripts/test/smoke.spec.mjs`

**Interfaces:**
- Consumes: `window.__cy` / `window.__graphTargetId`(テストフック、公開済み)。cytoscape の `closedNeighborhood()`(自身+接続エッジ+両端ノードのコレクション)
- Produces: `dimFocus`(モジュールスコープの選択中ノード id または null)、`applyDim()`(可視要素へ `.dimmed` を付け直す関数)。タップで発動、背景タップ・経路ハイライト変更で解除

- [ ] **Step 1: 失敗するテストを書く**

`scripts/test/smoke.spec.mjs` の末尾に追加:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs`
Expected: ⑥ が FAIL(タップ後も `.dimmed` が 0 件のため `waitForFunction` がタイムアウト)、①〜⑤ は PASS

- [ ] **Step 3: viewer.js にデクラッタを実装する**

(1) `CY_STYLE` の末尾(`edge.on-path` の後)にスタイルを追加:

```js
  {
    selector: 'node.dimmed',
    style: { opacity: 0.15 },
  },
  {
    selector: 'edge.dimmed',
    style: { opacity: 0.15 },
  },
```

(2) `initCy()` の直前(「// 3. 描画」セクション内、`let cy = null;` の後)に状態と関数を追加:

```js
// 選択時デクラッタ: タップ選択したノードの1ホップ近傍以外を減光する。
// programmatic な showDetail(初期表示・展開ボタン)では発動させず、
// ユーザーの明示的なタップ操作でのみ dimFocus を設定する。
let dimFocus = null;

function applyDim() {
  if (!cy) return;
  cy.elements('.dimmed').removeClass('dimmed');
  if (dimFocus === null) return;
  const focus = cy.getElementById(dimFocus);
  if (focus.length === 0) {
    // 選択ノードが非可視になった(再構築で消えた)場合は解除する
    dimFocus = null;
    return;
  }
  cy.elements().not(focus.closedNeighborhood()).not('.on-path').addClass('dimmed');
}
```

(3) `initCy()` のイベント登録を変更(既存の `cy.on('tap', 'node', ...)` を置き換え、背景タップを追加):

```js
  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id();
    dimFocus = id;
    applyDim();
    showDetail(id);
  });
  cy.on('tap', (evt) => {
    // 背景(キャンバス)タップで減光を解除する。詳細パネルは閉じない(#7 の範囲)。
    if (evt.target === cy) {
      dimFocus = null;
      applyDim();
    }
  });
```

(4) `render()` の末尾(`cy.layout(...).run();` の後)に再適用を追加:

```js
  applyDim();
```

(5) `onEntrySelectChange()` の先頭(`clearOnPath();` の直後)に解除を追加:

```js
  dimFocus = null;
```

補足: `onEntrySelectChange()` は途中で `render()` を呼ぶため、`dimFocus = null` を先頭で設定すれば `render()` 内の `applyDim()` が減光を解除する。`.on-path` の除外は `applyDim()` の `.not('.on-path')` が担う。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs`
Expected: ①〜⑥ すべて PASS

- [ ] **Step 5: 実グラフで目視確認する**

corelink の実 HTML を新テンプレートで再生成して目視確認する(グラフ JSON は生成済みHTMLから抽出済みのものを使う):

```bash
cd plugins/cc-func-understand/skills/func-understand/scripts
node generate-html.mjs \
  --graph /private/tmp/claude-501/-Users-ryutoharaguchi-develop-cc-plugins/fa4bb99c-d379-4c8c-94e0-22c7e49c3f5b/scratchpad/real-2026-07-29-1300-updateTikTokShopProducts.json \
  --out /private/tmp/claude-501/-Users-ryutoharaguchi-develop-cc-plugins/fa4bb99c-d379-4c8c-94e0-22c7e49c3f5b/scratchpad/verify-new-layout.html
```

Playwright で初期表示・全展開・ノードタップ(減光)のスクリーンショットを撮り、現状(`shot-current*.png`)と比較して改善していることを確認する。

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/templates/viewer.js plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs
git commit -m "feat(cc-func-understand): ノード選択時に非近傍を減光するデクラッタを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: バージョンと README の更新

**Files:**
- Modify: `plugins/cc-func-understand/.claude-plugin/plugin.json`(version)
- Modify: `plugins/cc-func-understand/README.md`(操作説明)

**Interfaces:**
- Consumes: Task 1・2 の機能(説明対象)
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: plugin.json のバージョンを上げる**

`plugins/cc-func-understand/.claude-plugin/plugin.json` の `"version": "0.3.0"` を `"version": "0.4.0"` に変更する。

- [ ] **Step 2: README に操作説明を追記する**

`plugins/cc-func-understand/README.md` のビューア操作の説明箇所(なければ機能説明の近く)に追記する。既存の文体に合わせて調整してよい:

```markdown
- ノードをタップすると、そのノードの 1 ホップ近傍以外が減光されて注目部分を追いやすくなる。背景をタップすると解除される。
```

変更履歴のセクションが README にある場合は v0.4.0 の行を追加する:

```markdown
- v0.4.0: グラフレイアウトを整理(issue #6)。dagre を align:DL + nodeSep:20 に調整、エッジを taxi ルーティングに変更、ノード選択時の近傍フォーカス(減光)を追加。
```

- [ ] **Step 3: 全テストを実行する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test && npx playwright test test/smoke.spec.mjs`
Expected: unit テスト・スモークテストすべて PASS

- [ ] **Step 4: コミット**

```bash
git add plugins/cc-func-understand/.claude-plugin/plugin.json plugins/cc-func-understand/README.md
git commit -m "docs(cc-func-understand): グラフレイアウト整理の説明を追記、v0.4.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
