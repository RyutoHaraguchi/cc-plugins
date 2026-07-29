# 詳細パネルの開閉・ドラッグリサイズ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cc-func-understand の HTML ビューア詳細パネルを、境界ハンドルで開閉でき、ドラッグで横幅を調整できるようにする(issue #7)。

**Architecture:** `#graph` と `#detail` の間にディバイダ要素(ドラッグ領域 + トグルボタン)を挿入し、Pointer Events で `#detail` の `flex-basis` を制御する。閉状態は `hidden` 属性(`display:none`)。開閉・リサイズ後は `cy.resize()` で cytoscape キャンバスを追従させる。外部ライブラリは使わない(自己完結 HTML の制約)。

**Tech Stack:** 素の JS/CSS(Pointer Events, flexbox)、Playwright smoke テスト。

**Spec:** `docs/superpowers/specs/2026-07-29-func-understand-panel-toggle-resize-design.md`

## Global Constraints

- 外部ライブラリ CDN は使用不可(自己完結 HTML)。開閉・リサイズは素の JS/CSS で実装する。
- 状態の永続化(localStorage)はしない。リロードで初期状態(開・420px)に戻る。
- パネル幅のクランプ: min 240px / max `window.innerWidth - 320px`。
- 初期状態は「開」のまま。既存 smoke テスト①〜⑦の前提を壊さない。
- テスト実行 cwd: `plugins/cc-func-understand/skills/func-understand/scripts/`。smoke は `npm run test:smoke`、単体は `npm test`。
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける。

---

### Task 1: ディバイダ要素と開閉トグル

**Files:**
- Modify: `plugins/cc-func-understand/skills/func-understand/templates/viewer.html:12-15`(`<main>` 内)
- Modify: `plugins/cc-func-understand/skills/func-understand/templates/viewer.css`(メインレイアウト節の後に追記)
- Modify: `plugins/cc-func-understand/skills/func-understand/templates/viewer.js`(セクション「5. 詳細パネル」の後に「5b. 詳細パネルの開閉・リサイズ」を新設)
- Test: `plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs`

**Interfaces:**
- Consumes: `cy`(cytoscape インスタンス、`viewer.js:57` の `let cy`)
- Produces: `setPanelOpen(open: boolean): void` と `detailPanel`(`#detail` 要素)。Task 2 がノード tap ハンドラから使う。DOM: `#divider` > `#detail-toggle`(button)。Task 3 が `#divider` に pointerdown を張る。

- [ ] **Step 1: 失敗するテストを書く**

`smoke.spec.mjs` の末尾に追加:

```js
test('⑧トグルボタンで詳細パネルが開閉できる', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator('#detail-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeVisible();
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs -g "⑧"`
Expected: FAIL(`#detail-toggle` が存在しないため click がタイムアウト)

- [ ] **Step 3: viewer.html にディバイダを追加する**

`viewer.html` の `<main>` を次に変更:

```html
  <main>
    <div id="graph"></div>
    <div id="divider"><button id="detail-toggle" type="button"></button></div>
    <aside id="detail"></aside>
  </main>
```

- [ ] **Step 4: viewer.css にディバイダとトグルのスタイルを追加する**

「詳細パネル」節の直前(メインレイアウト節の末尾)に追加:

```css
/* ---------------------------------------------------------- */
/* ディバイダ(リサイズ + 開閉トグル) */
/* ---------------------------------------------------------- */
#divider {
  flex: 0 0 8px;
  position: relative;
  cursor: col-resize;
  background: #161b22;
  border-left: 1px solid #30363d;
}

#divider:hover {
  background: #21262d;
}

#detail-toggle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 48px;
  padding: 0;
  font-size: 10px;
  line-height: 1;
}

body.resizing {
  user-select: none;
  cursor: col-resize;
}
```

(`body.resizing` は Task 3 のドラッグ中スタイル。ここでまとめて入れてよい。)

あわせて既存 `#detail` の `border-left: 1px solid #30363d;` は削除する(境界線はディバイダが担う)。

- [ ] **Step 5: viewer.js に開閉ロジックを追加する**

セクション「5. 詳細パネル」の末尾(「6. cytoscape イベント」コメントの直前)に追加:

```js
// ============================================================
// 5b. 詳細パネルの開閉・リサイズ
// ============================================================
const detailPanel = document.getElementById('detail');
const divider = document.getElementById('divider');
const detailToggle = document.getElementById('detail-toggle');

function updateToggleUi() {
  const open = !detailPanel.hidden;
  detailToggle.textContent = open ? '▶' : '◀';
  detailToggle.setAttribute('aria-expanded', String(open));
  detailToggle.setAttribute('aria-label', open ? '詳細パネルを閉じる' : '詳細パネルを開く');
}

function setPanelOpen(open) {
  detailPanel.hidden = !open;
  updateToggleUi();
  // コンテナサイズが変わるため、cytoscape 側のキャンバス寸法とヒットテストを追従させる
  if (cy) cy.resize();
}

detailToggle.addEventListener('click', () => setPanelOpen(detailPanel.hidden));
updateToggleUi();
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs -g "⑧"`
Expected: PASS

- [ ] **Step 7: 既存テストを含む全 smoke を実行する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm run test:smoke`
Expected: ①〜⑧すべて PASS(④ は初期状態「開」のため影響なし)

- [ ] **Step 8: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/templates/viewer.html \
        plugins/cc-func-understand/skills/func-understand/templates/viewer.css \
        plugins/cc-func-understand/skills/func-understand/templates/viewer.js \
        plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs
git commit -m "feat(cc-func-understand): 詳細パネルにディバイダと開閉トグルを追加 (#7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 閉状態でノード tap したらパネルを自動で開く

**Files:**
- Modify: `plugins/cc-func-understand/skills/func-understand/templates/viewer.js`(`initCy()` 内の `cy.on('tap', 'node', ...)` ハンドラ)
- Test: `plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs`

**Interfaces:**
- Consumes: Task 1 の `setPanelOpen(open)` と `detailPanel`。既存の `showDetail(id)`(`viewer.js:321`)。
- Produces: なし(挙動変更のみ)。

- [ ] **Step 1: 失敗するテストを書く**

`smoke.spec.mjs` の末尾に追加:

```js
test('⑨閉じた状態でノードをタップするとパネルが自動で開く', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  await page.click('#detail-toggle');
  await expect(page.locator('#detail')).toBeHidden();
  await page.evaluate(() => { window.__cy.getElementById(window.__graphTargetId).emit('tap'); });
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail .detail-name')).not.toBeEmpty();
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs -g "⑨"`
Expected: FAIL(tap してもパネルが hidden のまま)

- [ ] **Step 3: tap ハンドラに自動オープンを追加する**

`initCy()` 内の node tap ハンドラを次に変更:

```js
  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id();
    dimFocus = id;
    applyDim();
    // ユーザーの明示的なタップでのみ自動オープンする(programmatic な showDetail では開かない)
    if (detailPanel.hidden) setPanelOpen(true);
    showDetail(id);
  });
```

注意: `initCy()` の定義位置(セクション3)は 5b より前だが、実行は初期化ブロック(ファイル末尾)なので、5b の `const detailPanel` / `setPanelOpen` は定義済みで参照できる。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs -g "⑨"`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/templates/viewer.js \
        plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs
git commit -m "feat(cc-func-understand): 閉状態のノードタップで詳細パネルを自動オープン (#7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ディバイダのドラッグでパネル幅を変更する

**Files:**
- Modify: `plugins/cc-func-understand/skills/func-understand/templates/viewer.js`(セクション 5b の末尾に追記)
- Test: `plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs`

**Interfaces:**
- Consumes: Task 1 の `detailPanel` / `divider` / `detailToggle`、`cy`。CSS の `body.resizing`(Task 1 で追加済み)。
- Produces: なし(挙動追加のみ)。

- [ ] **Step 1: 失敗するテストを書く**

`smoke.spec.mjs` の末尾に追加:

```js
test('⑩ディバイダのドラッグでパネル幅が変わる', async ({ page }) => {
  await page.goto(generate('callback', 'itemHandler'));
  const before = await page.locator('#detail').evaluate((el) => el.getBoundingClientRect().width);
  const box = await page.locator('#divider').boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 120, startY, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('#detail').evaluate((el) => el.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before + 60);
});
```

(`+60` は「120px 左へドラッグしたら幅が有意に増える」の緩い下限。ディバイダ上の掴み位置による数 px の誤差を許容する。)

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs -g "⑩"`
Expected: FAIL(幅が変わらない)

- [ ] **Step 3: ドラッグリサイズを実装する**

セクション 5b の `updateToggleUi();` 呼び出しの前に追加:

```js
const PANEL_MIN_WIDTH = 240;
const GRAPH_MIN_WIDTH = 320; // グラフ側に最低限残す幅

function clampPanelWidth(w) {
  const max = Math.max(PANEL_MIN_WIDTH, window.innerWidth - GRAPH_MIN_WIDTH);
  return Math.min(Math.max(w, PANEL_MIN_WIDTH), max);
}

// トグルボタン上の pointerdown はドラッグ開始にしない(クリックとの競合防止)
detailToggle.addEventListener('pointerdown', (evt) => evt.stopPropagation());

divider.addEventListener('pointerdown', (evt) => {
  if (detailPanel.hidden) return; // 閉じているときはリサイズしない
  evt.preventDefault();
  divider.setPointerCapture(evt.pointerId);
  document.body.classList.add('resizing');
  const onMove = (moveEvt) => {
    detailPanel.style.flexBasis = `${clampPanelWidth(window.innerWidth - moveEvt.clientX)}px`;
  };
  const finish = () => {
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', finish);
    divider.removeEventListener('pointercancel', finish);
    document.body.classList.remove('resizing');
    if (cy) cy.resize();
  };
  divider.addEventListener('pointermove', onMove);
  divider.addEventListener('pointerup', finish);
  divider.addEventListener('pointercancel', finish);
});
```

(`setPointerCapture` により pointermove/up/cancel はディバイダ自身で受けられる。ウィンドウ縮小時の再クランプは次のドラッグ時に行われる — スペックどおり `window.resize` は監視しない。)

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npx playwright test test/smoke.spec.mjs -g "⑩"`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/templates/viewer.js \
        plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs
git commit -m "feat(cc-func-understand): ディバイダのドラッグで詳細パネル幅を変更可能に (#7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 全テスト実行とバージョン更新

**Files:**
- Modify: `plugins/cc-func-understand/.claude-plugin/plugin.json`(`"version": "0.4.0"` → `"0.5.0"`)
- Modify: `plugins/cc-func-understand/README.md`(変更履歴リストの末尾、v0.4.0 行の下)

**Interfaces:**
- Consumes: Task 1〜3 の成果すべて。
- Produces: なし(リリース準備)。

- [ ] **Step 1: smoke 全件と単体テストを実行する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm run test:smoke && npm test`
Expected: smoke ①〜⑩ PASS、単体テストすべて PASS

- [ ] **Step 2: plugin.json のバージョンを上げる**

`"version": "0.4.0"` を `"version": "0.5.0"` に変更。

- [ ] **Step 3: README に変更履歴を追記する**

README.md の変更履歴リスト(95行目付近、v0.4.0 行の下)に追加:

```markdown
- v0.5.0: 詳細パネルを開閉・リサイズ可能に(issue #7)。グラフとの境界にディバイダを追加し、トグルボタンで開閉、ドラッグで横幅調整(240px〜)。閉状態でノードをタップすると自動で開く。
```

- [ ] **Step 4: コミット**

```bash
git add plugins/cc-func-understand/.claude-plugin/plugin.json plugins/cc-func-understand/README.md
git commit -m "docs(cc-func-understand): 詳細パネル開閉・リサイズの説明を追記、v0.5.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
