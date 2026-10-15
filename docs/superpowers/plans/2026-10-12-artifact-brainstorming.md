# artifact-brainstorming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** brainstorming の問い・承認・設計の提示を、図解アーティファクト上の目印とポップオーバーで行う個人用 skill `artifact-brainstorming` を作る。

**Architecture:**
- skill は 4 ファイルで構成する: `SKILL.md`、`references/loop.md`、`references/questions.md`、`templates/page.html`。brainstorming の手順は参照するだけで、書き写さない。
- `templates/page.html` は 1 枚の HTML で、スクリプトを 3 つに分ける。
  - 純粋関数（`<script id="core">`）: node の標準テストで確かめる。
  - データ（`<script id="data">`）: Claude が書き換える部分。
  - 画面の処理（`<script id="ui">`）: ブラウザで確かめる。

**Tech Stack:** 素の HTML/CSS/JS（外部ライブラリなし）、inline SVG、claude.ai の Artifact `comments` 機能（`claude.use("comments")`）、node 26 の `node:test` と `node:vm`。

**Spec:** `/Users/ryutoharaguchi/develop/docs/superpowers/specs/2026-10-12-artifact-brainstorming-design.md`

## Global Constraints

- skill の置き場所: `~/.claude/skills/artifact-brainstorming/`
  - 個人用。hb・private の設定からもシンボリックリンク経由で使える。
- skill 名は `artifact-brainstorming`。起動は名前で呼んだときだけ。
  - 名前で呼ぶとは、`/artifact-brainstorming` と打つか、「アーティファクトで壁打ちして」と明示すること。
  - brainstorming のたびに自動では使わない。
- brainstorming の手順（分類・案の比較・設計書・writing-plans への受け渡し）は書き写さず参照する。
- 図は Mermaid を使わず、データから描く SVG にする。
- 問いは 1 問ずつ、親の分岐から出す。
- 問いは必ず文脈の中の目印から開くポップオーバーで出す。セクションに並べない。
- 参照は文末にまとめず、文中の言葉にリンクする。
- 回答を送れたら、ポップオーバーをすぐ閉じる（折りたたむ）。
- チャットに書くのは、回答のたびに 1〜2 行とリンクだけ。
- 外部レビュー（Codex・Opus）は skill の手順に入れない。
- 外部ライブラリは使わない（アーティファクトの CSP があり、依存も不要なため）。
- 開発用の git リポジトリは `~/.claude/skills/artifact-brainstorming/` の中に作る（`~/develop` も `~/.claude/skills` も git の管理下ではないため）。
- コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける。

## Review Focus

1. **送信文が長すぎる**: 補足欄に日本語を 1500 字書くと UTF-8 で 4 KiB を超え、`sendToClaude` が `invalid` で失敗する。期待する挙動は、4000 バイト以内に切って送れること。
   - 観察したページは「3800 文字」で切っていたので、日本語では超えていた。
   - Task 1 の `buildMessage` のテストで固定する。
2. **ノードのラベルが長い**: 箱からはみ出さず、3 行で「…」になること。Task 1 の `wrapLabel` のテストで固定する。
3. **同じ場所に問いが 2 つある**（取り消した Q1 と、作り直した Q1R）: 目印が 2 つ並び、どちらも開けること。Task 1 の `idsOf` のテストと、Task 3 のブラウザ確認で固定する。
4. **目印の場所が無い問い**: データにはあるのに、本文にも図にも目印が無い問い。黙って消えず、上部の進み具合に「置き場所が無い問い：Q5」と出ること。Task 1 の `orphanQuestions` のテストと、Task 3 の確認で固定する。
5. **アーティファクトの外で開いた／送れない状態**（`claude` が無い、`no_session` など）: 押した後に理由とコピー用の文面が出ること。Task 3 のブラウザ確認で固定する。ローカルで開くと `window.claude` が無いので、この状態になる。

---

## File Structure

```
~/.claude/skills/artifact-brainstorming/
├── SKILL.md                 # 起動条件・流れ・常に守ること（Task 6）
├── references/
│   ├── questions.md         # 問いの書き方・置き場所・取り消し方（Task 4）
│   └── loop.md              # 受け取りループ・自動返信・失敗時・引き継ぎ（Task 5）
├── templates/
│   └── page.html            # 図解ページのひな形（Task 1〜3）
└── tests/
    └── core.test.mjs        # page.html の core スクリプトの単体テスト（Task 1）
```

`tests/` は skill の実行時には読まれない。skill の説明文と参照からは触れない。

---

### Task 1: リポジトリと core の純粋関数

**Files:**
- Create: `~/.claude/skills/artifact-brainstorming/templates/page.html`（この Task では core スクリプトと最小の骨格だけ）
- Test: `~/.claude/skills/artifact-brainstorming/tests/core.test.mjs`

**Interfaces:**
- Produces（`<script id="core">` の中で `function` 宣言する。Task 2・3 が使う）:
  - `GRID`: `{ cw: 240, rh: 110, ox: 32, oy: 28, bw: 196, bh: 56 }`
  - `layoutNode(node, grid = GRID) -> { x, y, w, h, cx, cy }`
    - `node = { id, kind: "start"|"process"|"decision"|"end", col, row, label, q? }`
  - `edgePath(fromNode, toNode, grid = GRID) -> string`（SVG の path の d）
  - `wrapLabel(text, max, maxLines = 3) -> string[]`
  - `idsOf(value) -> string[]`（`"Q1 Q1R"` または `["Q1","Q1R"]` を受け取る）
  - `markerInfo(question, sentIds = []) -> { label, mark, cls, text }`
  - `progress(questions) -> { done, open, recheck, revoked }`
  - `progressText(counts) -> string`
  - `answerBody(question, key, note) -> string`
  - `buildMessage(tag, question, kind, body) -> string`（UTF-8 で 4000 バイト以内）
  - `diagramQuestionIds(diagrams) -> string[]`
  - `orphanQuestions(questions, textIds, diagrams) -> string[]`
  - question の形:
    - `{ id, status: "open"|"done"|"revoked"|"recheck", title, situation, example?, options: [{key,label,effect}], recommended, recommendWhy, answer?, revokedBy?, revokedWhy?, recheckWhy? }`

- [ ] **Step 1: リポジトリを作る**

```bash
mkdir -p ~/.claude/skills/artifact-brainstorming/{references,templates,tests}
cd ~/.claude/skills/artifact-brainstorming && git init
```

- [ ] **Step 2: 失敗するテストを書く**

`~/.claude/skills/artifact-brainstorming/tests/core.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../templates/page.html", import.meta.url), "utf8");
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
assert.ok(m, 'templates/page.html に <script id="core"> がない');
const ctx = vm.createContext({ TextEncoder });
vm.runInContext(m[1], ctx);
const c = ctx;

const q = (over = {}) => ({
  id: "Q1", status: "open", title: "題", situation: "", recommended: "a", recommendWhy: "",
  options: [{ key: "a", label: "案A", effect: "" }, { key: "b", label: "案B", effect: "" }],
  ...over,
});

test("layoutNode は列と行からマス目の座標を出す", () => {
  const r = c.layoutNode({ col: 1, row: 2 });
  assert.equal(r.x, 32 + 240);
  assert.equal(r.y, 28 + 220);
  assert.equal(r.cx, r.x + 98);
  assert.equal(r.cy, r.y + 28);
});

test("edgePath: 同じ列は縦の直線、違う列は直交の折れ線、同じ行は横線", () => {
  const a = { col: 0, row: 0, kind: "process" };
  assert.match(c.edgePath(a, { col: 0, row: 1, kind: "process" }), /^M130,84 V136$/);
  assert.match(c.edgePath(a, { col: 1, row: 1, kind: "process" }), /^M130,84 V\d+(\.\d+)? H370 V136$/);
  assert.match(c.edgePath(a, { col: 1, row: 0, kind: "process" }), /^M228,56 H270$/);
});

test("edgePath: ひし形に向かう矢印は先端を少し手前で止める", () => {
  const a = { col: 0, row: 0, kind: "process" };
  assert.equal(c.edgePath(a, { col: 0, row: 1, kind: "decision" }), "M130,84 V126");
});

test("wrapLabel: 指定文字数で折り返し、3 行を超えたら … で切る", () => {
  assert.deepEqual(Array.from(c.wrapLabel("あいうえおか", 3)), ["あいう", "えおか"]);
  const long = c.wrapLabel("あ".repeat(20), 4);
  assert.equal(long.length, 3);
  assert.equal(long[2], "あああ…");
});

test("idsOf: 空白区切りの文字列と配列の両方を受け取る", () => {
  assert.deepEqual(Array.from(c.idsOf("Q1 Q1R")), ["Q1", "Q1R"]);
  assert.deepEqual(Array.from(c.idsOf(["Q2"])), ["Q2"]);
  assert.deepEqual(Array.from(c.idsOf(undefined)), []);
});

test("markerInfo: 状態ごとの印。回答待ちで送信済みなら … を出す", () => {
  assert.equal(c.markerInfo(q({ status: "done" })).mark, "✓");
  assert.equal(c.markerInfo(q({ status: "revoked" })).cls, "m-revoked");
  assert.equal(c.markerInfo(q({ status: "recheck" })).text, "要確認");
  assert.equal(c.markerInfo(q(), ["Q1"]).text, "送信済み");
  assert.equal(c.markerInfo(q({ status: "done" }), ["Q1"]).text, "決定");
  assert.equal(c.markerInfo(q({ status: "unknown" })).text, "回答待ち");
});

test("progress と progressText", () => {
  const counts = c.progress([q({ status: "done" }), q({ status: "done" }), q(), q({ status: "recheck" }), q({ status: "revoked" })]);
  assert.deepEqual({ ...counts }, { done: 2, open: 1, recheck: 1, revoked: 1 });
  assert.equal(c.progressText(counts), "決定 2 ／ 回答待ち 1 ／ 要確認 1");
  assert.equal(c.progressText({ done: 1, open: 0, recheck: 0, revoked: 0 }), "決定 1 ／ 回答待ち 0");
});

test("answerBody: 選んだ案と補足。補足が空なら行を出さない。知らない案は投げる", () => {
  assert.equal(c.answerBody(q(), "b", "  "), "選択：b「案B」");
  assert.equal(c.answerBody(q(), "a", "理由"), "選択：a「案A」\n補足：理由");
  assert.throws(() => c.answerBody(q(), "z", ""), /unknown option z/);
});

test("buildMessage: 形式と、UTF-8 で 4000 バイト以内への切り詰め", () => {
  assert.equal(c.buildMessage("壁打ち", q(), "への回答", "選択：a"), "[壁打ち] Q1「題」への回答\n選択：a");
  const msg = c.buildMessage("壁打ち", q(), "への回答", "あ".repeat(1500));
  assert.ok(new TextEncoder().encode(msg).length <= 4000);
  assert.ok(!msg.endsWith("�"));
});

test("orphanQuestions: 本文にも図にも目印が無い問いを返す", () => {
  const diagrams = { main: { nodes: [{ id: "n1", col: 0, row: 0, label: "", q: "Q1 Q1R" }], edges: [] } };
  const qs = [q({ id: "Q0" }), q({ id: "Q1" }), q({ id: "Q1R" }), q({ id: "Q5" })];
  assert.deepEqual(Array.from(c.diagramQuestionIds(diagrams)), ["Q1", "Q1R"]);
  assert.deepEqual(Array.from(c.orphanQuestions(qs, ["Q0"], diagrams)), ["Q5"]);
});
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `node --test ~/.claude/skills/artifact-brainstorming/tests/`
Expected: FAIL。`templates/page.html` が無いので ENOENT になる。

- [ ] **Step 4: core スクリプトを持つ最小の page.html を書く**

`~/.claude/skills/artifact-brainstorming/templates/page.html`（Task 2 で骨格を足す。ここでは core だけ）:

```html
<title>図解ひな形</title>
<script id="core">
/* 純粋関数。DOM に触らない。tests/core.test.mjs が vm で読み込んで確かめる。 */
var GRID = { cw: 240, rh: 110, ox: 32, oy: 28, bw: 196, bh: 56 };

function layoutNode(n, g) {
  g = g || GRID;
  var x = g.ox + n.col * g.cw, y = g.oy + n.row * g.rh;
  return { x: x, y: y, w: g.bw, h: g.bh, cx: x + g.bw / 2, cy: y + g.bh / 2 };
}

function edgePath(from, to, g) {
  g = g || GRID;
  var a = layoutNode(from, g), b = layoutNode(to, g);
  if (from.row === to.row) {
    var dir = to.col > from.col ? 1 : -1;
    var x1 = a.cx + dir * a.w / 2;
    var x2 = b.cx - dir * (b.w / 2 + (to.kind === "decision" ? 12 : 2));
    return "M" + x1 + "," + a.cy + " H" + x2;
  }
  var down = to.row > from.row ? 1 : -1;
  var y1 = a.cy + down * (a.h / 2 + (from.kind === "decision" ? 10 : 0));
  var y2 = b.cy - down * (b.h / 2 + (to.kind === "decision" ? 12 : 2));
  if (a.cx === b.cx) return "M" + a.cx + "," + y1 + " V" + y2;
  var my = (y1 + y2) / 2;
  return "M" + a.cx + "," + y1 + " V" + my + " H" + b.cx + " V" + y2;
}

function wrapLabel(text, max, maxLines) {
  maxLines = maxLines || 3;
  var chars = Array.from(String(text == null ? "" : text));
  var lines = [];
  for (var i = 0; i < chars.length; i += max) lines.push(chars.slice(i, i + max).join(""));
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = Array.from(lines[maxLines - 1]).slice(0, max - 1).join("") + "…";
  }
  return lines;
}

function idsOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.slice();
  return String(value).split(/\s+/).filter(Boolean);
}

var STATUS = {
  open: { mark: "?", cls: "m-open", text: "回答待ち" },
  done: { mark: "✓", cls: "m-done", text: "決定" },
  revoked: { mark: "×", cls: "m-revoked", text: "取り消し" },
  recheck: { mark: "!", cls: "m-recheck", text: "要確認" }
};

function markerInfo(q, sentIds) {
  sentIds = sentIds || [];
  var s = STATUS[q.status] || STATUS.open;
  var isOpen = !STATUS[q.status] || q.status === "open";
  if (isOpen && sentIds.indexOf(q.id) >= 0) return { label: q.id, mark: "…", cls: "m-sent", text: "送信済み" };
  return { label: q.id, mark: s.mark, cls: s.cls, text: s.text };
}

function progress(questions) {
  var c = { done: 0, open: 0, recheck: 0, revoked: 0 };
  questions.forEach(function (q) { c[c.hasOwnProperty(q.status) ? q.status : "open"]++; });
  return c;
}

function progressText(c) {
  var parts = ["決定 " + c.done, "回答待ち " + c.open];
  if (c.recheck) parts.push("要確認 " + c.recheck);
  return parts.join(" ／ ");
}

function answerBody(q, key, note) {
  var o = q.options.filter(function (x) { return x.key === key; })[0];
  if (!o) throw new Error("unknown option " + key);
  var n = String(note || "").trim();
  return "選択：" + o.key + "「" + o.label + "」" + (n ? "\n補足：" + n : "");
}

var MAX_BYTES = 4000; /* sendToClaude は UTF-8 で 4 KiB まで。余裕を残す */
function buildMessage(tag, q, kind, body) {
  var text = "[" + tag + "] " + q.id + "「" + q.title + "」" + kind + "\n" + body;
  var enc = new TextEncoder();
  if (enc.encode(text).length <= MAX_BYTES) return text;
  var chars = Array.from(text), lo = 0, hi = chars.length;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(chars.slice(0, mid).join("") + "…").length <= MAX_BYTES) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join("") + "…";
}

function diagramQuestionIds(diagrams) {
  var ids = [];
  Object.keys(diagrams).forEach(function (k) {
    diagrams[k].nodes.forEach(function (n) { ids = ids.concat(idsOf(n.q)); });
  });
  return ids;
}

function orphanQuestions(questions, textIds, diagrams) {
  var have = {};
  textIds.concat(diagramQuestionIds(diagrams)).forEach(function (id) { have[id] = true; });
  return questions.filter(function (q) { return !have[q.id]; }).map(function (q) { return q.id; });
}
</script>
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `node --test ~/.claude/skills/artifact-brainstorming/tests/`
Expected: PASS（10 tests）

- [ ] **Step 6: コミット**

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'feat: core functions for diagram layout, markers and messages\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 2: ページの骨格と図の描画

**Files:**
- Modify: `~/.claude/skills/artifact-brainstorming/templates/page.html`（core の前に style と本文、core の後に data と ui の描画部分を足す）

**Interfaces:**
- Consumes: Task 1 の `GRID`, `layoutNode`, `edgePath`, `wrapLabel`, `idsOf`
- Produces（Task 3 が使う）:
  - データ: `PAGE = { tag: string }`、`DIAGRAMS = { [name]: { nodes, edges } }`、`QUESTIONS = question[]`
  - DOM: 図は `<figure class="flow" data-diagram="名前">` の中に描く。ノードに問いがあれば、`<g class="node" data-node="id" data-q="Q1 Q1R">` の右上に目印を置く場所を残す。
  - 関数: `drawDiagrams()`。全図を描き直す。何度呼んでもよい。

- [ ] **Step 1: page.html の先頭（core の前）に style と本文を入れる**

`<title>図解ひな形</title>` の直後に次を入れる。サンプルの題は汎用の「通知設定の保存」にする。4 つの状態（決定・取り消し・作り直し・要確認）を入れて、確認とお手本に使う。

```html
<style>
/* layout: 1 列の読み物。図は方眼のキャンバスで横スクロール可。問いは目印とポップオーバーだけ */
:root {
  --bg: #f5f6f8; --paper: #ffffff; --grid: #e3e7ed; --fg: #1c232e; --muted: #5d6879;
  --line: #3a485b; --accent: #c2410c; --accent-soft: #fff0e6; --done: #23794a; --done-soft: #e6f5ec;
  --warn: #a16207; --warn-soft: #fdf4dc; --off: #8792a3;
  --font-body: "IBM Plex Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #11151b; --paper: #192029; --grid: #232c37; --fg: #e5e9ef; --muted: #9aa5b5;
    --line: #a9b5c5; --accent: #fb8a4c; --accent-soft: #3a2316; --done: #6ccf95; --done-soft: #19321f;
    --warn: #f1c453; --warn-soft: #342a10; --off: #6b7789; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #11151b; --paper: #192029; --grid: #232c37; --fg: #e5e9ef; --muted: #9aa5b5;
  --line: #a9b5c5; --accent: #fb8a4c; --accent-soft: #3a2316; --done: #6ccf95; --done-soft: #19321f;
  --warn: #f1c453; --warn-soft: #342a10; --off: #6b7789; color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font-family: var(--font-body); line-height: 1.7; }
main, .top { max-width: 860px; margin: 0 auto; padding-inline: 16px; }
.top { padding-block: 24px 4px; }
main { padding-block: 8px 80px; display: grid; gap: 28px; }
h1 { font-size: 1.45rem; margin: 0; text-wrap: balance; }
h2 { font-size: 1.12rem; margin: 0 0 8px; text-wrap: balance; }
p { margin: 8px 0; max-width: 68ch; }
a { color: var(--accent); }
.progress { font-size: .88rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.progress .warn { color: var(--warn); }
figure.flow { margin: 12px 0; }
figure.flow figcaption { font-size: .85rem; color: var(--muted); margin-top: 6px; }
.canvas { background: var(--paper); border: 1px solid var(--grid); border-radius: 6px; overflow-x: auto; }
.canvas svg { display: block; }
.canvas text { font-family: var(--font-body); fill: var(--fg); }
.tbl { overflow-x: auto; }
table { border-collapse: collapse; font-size: .9rem; }
th, td { border: 1px solid var(--grid); padding: 6px 10px; text-align: left; vertical-align: top; background: var(--paper); }
</style>

<header class="top">
  <h1>通知設定の保存（サンプル）</h1>
  <p class="progress" id="progress"></p>
</header>
<main>
  <section id="ch1">
    <h2>1. 何を決めたいか</h2>
    <p>利用者が通知設定を変えたときに、<span data-q="Q0">いつ保存するか</span>を決めます。いまは画面を離れると変更が消えます。保存の流れは<a href="#fig-save">保存の流れの図</a>のとおりです。</p>
  </section>
  <section id="ch2">
    <h2>2. 保存の流れ</h2>
    <figure class="flow" id="fig-save" data-diagram="save">
      <figcaption>設定を変えてから保存されるまで</figcaption>
    </figure>
    <p>失敗したときの見せ方は、<span data-q="Q2">エラーの出し方</span>の問いで扱います。</p>
  </section>
</main>
<div id="pop" role="dialog" aria-modal="false" hidden></div>
```

- [ ] **Step 2: core の後ろに data スクリプトを入れる**

```html
<script id="data">
/* Claude が書き換える部分。図・問いはここだけを直す。 */
var PAGE = { tag: "壁打ち" };
var DIAGRAMS = {
  save: {
    nodes: [
      { id: "edit", kind: "start", col: 0, row: 0, label: "利用者が設定を変える" },
      { id: "when", kind: "decision", col: 0, row: 1, label: "いつ保存する？", q: "Q1 Q1R" },
      { id: "store", kind: "process", col: 0, row: 2, label: "サーバーに保存する" },
      { id: "err", kind: "process", col: 1, row: 2, label: "失敗を知らせる" }
    ],
    edges: [
      { from: "edit", to: "when" },
      { from: "when", to: "store", label: "決まったら" },
      { from: "store", to: "err", label: "失敗", dashed: true }
    ]
  }
};
var QUESTIONS = [
  { id: "Q0", status: "done", title: "保存のきっかけを決める必要があるか", situation: "<p>いまは画面を離れると変更が消える。</p>",
    options: [{ key: "a", label: "決める", effect: "保存の流れを設計する" }, { key: "b", label: "今のままでよい", effect: "何もしない" }],
    recommended: "a", recommendWhy: "変更が消える問い合わせが来ているため",
    answer: "<strong>決定：a「決める」</strong>。保存のきっかけを Q1 で決める。" },
  { id: "Q1", status: "revoked", title: "保存ボタンで保存するか", situation: "<p>保存ボタンを置くか、自動で保存するか。</p>",
    options: [{ key: "a", label: "保存ボタン", effect: "押し忘れると消える" }, { key: "b", label: "自動保存", effect: "変えるたびに保存" }],
    recommended: "a", recommendWhy: "",
    answer: "<strong>決定：a「保存ボタン」</strong>", revokedBy: "Q1R", revokedWhy: "押し忘れで消える問い合わせが続くと分かったため" },
  { id: "Q1R", status: "open", title: "自動保存の間隔をどうするか",
    situation: "<p>Q1 を取り消し、自動保存にすると決め直した。残るのは間隔。</p>",
    example: "<div class=\"tbl\"><table><thead><tr><th>間隔</th><th>利用者から見えること</th></tr></thead><tbody><tr><td>変えるたび</td><td>すぐ保存される。通信が増える</td></tr><tr><td>1 秒待って</td><td>続けて変えたときはまとめて保存</td></tr></tbody></table></div>",
    options: [{ key: "a", label: "1 秒待ってまとめる", effect: "通信が減る。直後に閉じると最後の 1 秒が消える" }, { key: "b", label: "変えるたび", effect: "消えないが通信が増える" }],
    recommended: "a", recommendWhy: "通知設定は続けて切り替えることが多いため" },
  { id: "Q2", status: "recheck", title: "保存に失敗したときの出し方", situation: "<p>失敗したことを画面にどう出すか。</p>",
    recheckWhy: "Q1 が取り消されたので、ボタン前提の案を見直す必要がある",
    options: [{ key: "a", label: "画面上部に帯", effect: "目立つ" }, { key: "b", label: "項目の横に小さく", effect: "どれが失敗したか分かる" }],
    recommended: "b", recommendWhy: "自動保存では項目ごとに失敗しうるため" }
];
</script>
```

- [ ] **Step 3: data の後ろに ui スクリプトの描画部分を入れる**

```html
<script id="ui">
(function () {
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(t, a) { var e = document.createElementNS(NS, t); for (var k in (a || {})) e.setAttribute(k, a[k]); return e; }

  function drawDiagram(fig) {
    var name = fig.getAttribute("data-diagram"), d = DIAGRAMS[name];
    var old = fig.querySelector(".canvas"); if (old) old.remove();
    if (!d) { console.warn("図のデータが無い:", name); return; }
    var cols = Math.max.apply(null, d.nodes.map(function (n) { return n.col; })) + 1;
    var rows = Math.max.apply(null, d.nodes.map(function (n) { return n.row; })) + 1;
    var W = GRID.ox * 2 + (cols - 1) * GRID.cw + GRID.bw + 120, H = GRID.oy * 2 + (rows - 1) * GRID.rh + GRID.bh + 12;
    var cap = fig.querySelector("figcaption");
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": cap ? cap.textContent : name });
    var defs = svgEl("defs");
    var pat = svgEl("pattern", { id: "grid-" + name, width: 24, height: 24, patternUnits: "userSpaceOnUse" });
    pat.append(svgEl("path", { d: "M 24 0 L 0 0 0 24", fill: "none", stroke: "var(--grid)", "stroke-width": 1 }));
    var mk = svgEl("marker", { id: "arrow-" + name, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" });
    mk.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--line)" }));
    defs.append(pat, mk);
    svg.append(defs, svgEl("rect", { width: W, height: H, fill: "url(#grid-" + name + ")" }));

    var byId = {}; d.nodes.forEach(function (n) { byId[n.id] = n; });
    d.edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) { console.warn("矢印の端が無い:", e); return; }
      svg.append(svgEl("path", { d: edgePath(a, b), fill: "none", stroke: "var(--line)", "stroke-width": 1.5,
        "stroke-dasharray": e.dashed ? "5 4" : "none", "marker-end": "url(#arrow-" + name + ")" }));
      if (e.label) {
        var la = layoutNode(a), lb = layoutNode(b);
        var t = svgEl("text", { x: (la.cx + lb.cx) / 2 + 6, y: (la.cy + lb.cy) / 2 - 4, "font-size": 12 });
        t.textContent = e.label; svg.append(t);
      }
    });

    d.nodes.forEach(function (n) {
      var r = layoutNode(n), g = svgEl("g", { class: "node", "data-node": n.id });
      if (n.q) g.setAttribute("data-q", idsOf(n.q).join(" "));
      var common = { fill: "var(--paper)", stroke: "var(--line)", "stroke-width": 1.5 };
      if (n.kind === "decision") {
        g.append(svgEl("polygon", Object.assign({ points: r.cx + "," + (r.y - 10) + " " + (r.x + r.w + 10) + "," + r.cy + " " + r.cx + "," + (r.y + r.h + 10) + " " + (r.x - 10) + "," + r.cy }, common)));
      } else {
        g.append(svgEl("rect", Object.assign({ x: r.x, y: r.y, width: r.w, height: r.h, rx: (n.kind === "start" || n.kind === "end") ? r.h / 2 : 8 }, common)));
      }
      var lines = wrapLabel(n.label, n.kind === "decision" ? 10 : 13);
      lines.forEach(function (ln, i) {
        var t = svgEl("text", { x: r.cx, y: r.cy + (i - (lines.length - 1) / 2) * 16 + 5, "text-anchor": "middle", "font-size": 13 });
        t.textContent = ln; g.append(t);
      });
      svg.append(g);
    });

    var wrap = document.createElement("div"); wrap.className = "canvas"; wrap.append(svg);
    fig.insertBefore(wrap, fig.firstChild);
  }

  window.drawDiagrams = function () {
    document.querySelectorAll("figure.flow[data-diagram]").forEach(drawDiagram);
  };
  window.drawDiagrams();
})();
</script>
```

- [ ] **Step 4: 単体テストと構文を確かめる**

Run: `node --test ~/.claude/skills/artifact-brainstorming/tests/ && cd ~/.claude/skills/artifact-brainstorming && for id in core data ui; do perl -0ne "print \$1 if /<script id=\"$id\">(.*?)<\/script>/s" templates/page.html > /tmp/ab-$id.js && node --check /tmp/ab-$id.js && echo "$id OK"; done`
Expected: テストが PASS し、`core OK` `data OK` `ui OK` が出る。

- [ ] **Step 5: ブラウザで図を確かめる**

Browser pane は `file://` のページを操作できない。そこでローカルの静的サーバーで開く。

1. `~/develop/.claude/launch.json` に次の設定を置く（無ければ作る。あれば `configurations` に足す）。

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "ab-template",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8765", "-d", "/Users/ryutoharaguchi/.claude/skills/artifact-brainstorming/templates"],
      "port": 8765
    }
  ]
}
```

2. `preview_start` に `{name: "ab-template"}` を渡して開き、`http://localhost:8765/page.html` へ移動する。
3. 確かめる。

確かめること:
- 方眼の上に、角丸の箱 3 つとひし形 1 つが描かれている。
- 縦・横・折れ線の矢印が箱の縁で止まっている。
- 「失敗」の矢印が点線になっている。
- ラベルが箱からはみ出していない。

- [ ] **Step 6: コミット**

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'feat: page skeleton and SVG diagram rendering\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: 目印・ポップオーバー・折りたたみ・送信とコピー欄

**Files:**
- Modify: `~/.claude/skills/artifact-brainstorming/templates/page.html`（style に目印とポップオーバーの CSS を足す。ui スクリプトの `window.drawDiagrams();` の行の後ろに処理を足す）

**Interfaces:**
- Consumes:
  - Task 1: `markerInfo`, `progress`, `progressText`, `answerBody`, `buildMessage`, `orphanQuestions`, `idsOf`
  - Task 2: `PAGE`, `DIAGRAMS`, `QUESTIONS`, `drawDiagrams`, `g.node[data-q]`, `#pop`, `#progress`
- Produces（skill の手順と references が前提にするページの約束事）:
  - 本文の `<span data-q="ID">` の直後に `<button class="mk">` の目印が付く。
  - 図のノードの `q` に問いの id を書くと、そのノードの右上に目印が付く。
  - 送信文の形式は `[PAGE.tag] ID「題」への回答\n選択：k「案」\n補足：…` と `[PAGE.tag] ID「題」について質問\n本文`。
  - 送信済みかどうかは、閲覧者のブラウザの `localStorage["ab-sent"]` に持つ（閲覧者ごとの便宜で、無くても動く）。

- [ ] **Step 1: style の末尾に CSS を足す**

```css
.mk { display: inline-flex; align-items: center; gap: 3px; margin-left: 4px; padding: 0 6px; height: 1.45em; vertical-align: .1em;
  font: 600 .72rem/1 var(--font-mono); border-radius: 999px; border: 1.5px solid currentColor; background: var(--paper); cursor: pointer; }
.mk:focus-visible, .mk-svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.m-open { color: var(--accent); background: var(--accent-soft); }
.m-sent { color: var(--muted); border-style: dashed; }
.m-done { color: var(--done); background: var(--done-soft); }
.m-revoked { color: var(--off); text-decoration: line-through; }
.m-recheck { color: var(--warn); background: var(--warn-soft); }
.mk-svg { cursor: pointer; }
#pop { position: absolute; z-index: 10; background: var(--paper); color: var(--fg); border: 1.5px solid var(--line);
  border-radius: 8px; box-shadow: 0 8px 28px rgb(0 0 0 / .18); padding: 14px 16px; max-height: 70vh; overflow: auto; }
#pop.sheet { position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto !important; max-height: 80vh;
  border-radius: 12px 12px 0 0; padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)); }
.pop-head { display: flex; align-items: baseline; gap: 8px; }
.pop-head .t { font-weight: 700; flex: 1; min-width: 0; }
.pop-head .x { border: 0; background: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; }
.opt { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; padding: 8px; border: 1px solid var(--grid); border-radius: 6px; margin: 6px 0; cursor: pointer; }
.opt .eff { grid-column: 2; color: var(--muted); font-size: .88rem; }
.rec { margin-left: 6px; font-size: .72rem; color: var(--accent); border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; }
.pop textarea, #pop textarea { width: 100%; min-height: 4.5em; box-sizing: border-box; font: inherit; }
.btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.btn { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1.5px solid var(--accent); background: var(--accent); color: var(--paper); cursor: pointer; }
.btn.ghost { background: transparent; color: var(--accent); }
.btn:disabled { opacity: .5; cursor: default; }
.msg { font-size: .88rem; margin-top: 6px; }
.msg.err { color: var(--accent); }
.note { font-size: .88rem; color: var(--muted); }
.answer { padding: 8px 10px; border-radius: 6px; background: var(--done-soft); }
.revoked { padding: 8px 10px; border-radius: 6px; background: var(--grid); }
.recheck { padding: 8px 10px; border-radius: 6px; background: var(--warn-soft); }
```

- [ ] **Step 2: ui スクリプトに目印・進み具合・ポップオーバー・送信を足す**

`window.drawDiagrams();` の行を次で置き換える（drawDiagrams の定義はそのまま残す）。

```js
  var byQ = {}; QUESTIONS.forEach(function (q) { byQ[q.id] = q; });
  var sent = {};
  try { sent = JSON.parse(localStorage.getItem("ab-sent") || "{}") || {}; } catch (e) { sent = {}; }
  function saveSent() { try { localStorage.setItem("ab-sent", JSON.stringify(sent)); } catch (e) {} }
  var api = null, sendState = "checking", current = null;
  var pop = document.getElementById("pop");

  var STATE_TEXT = {
    available: "",
    checking: "送信できるか確かめています…",
    writers_only: "編集権限が無いため Claude へ送れません。下の文面をコピーしてチャットに貼ってください。",
    no_session: "いま受け取れる Claude のセッションがありません。下の文面をコピーしてチャットに貼ってください。",
    off: "このビューでは Claude へ送れません。下の文面をコピーしてチャットに貼ってください。",
    none: "このビューではコメント機能が使えません。下の文面をコピーしてチャットに貼ってください。"
  };
  var ERROR_TEXT = {
    consent_required: "許可されなかったため送っていません。もう一度押すか、下の文面をコピーしてチャットに貼ってください。",
    forbidden: "このページからは送れません。下の文面をコピーしてチャットに貼ってください。",
    rate_limited: "送信が続いたため止められました。少し待ってから押してください。",
    claude_unavailable: "Claude に届けられませんでした（何も投稿していません）。下の文面をコピーしてチャットに貼ってください。",
    invalid: "文面が長すぎるか不正です。補足を短くするか、下の文面をコピーしてチャットに貼ってください。"
  };

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function textIds() {
    var ids = [];
    document.querySelectorAll("[data-q]").forEach(function (n) { if (!n.closest("svg")) ids = ids.concat(idsOf(n.getAttribute("data-q"))); });
    return ids;
  }

  function renderProgress() {
    var p = document.getElementById("progress"); p.replaceChildren();
    p.append(document.createTextNode(progressText(progress(QUESTIONS))));
    QUESTIONS.filter(function (q) { return q.status === "open" || q.status === "recheck"; }).forEach(function (q) {
      var b = el("button", { type: "button", class: "mk " + markerInfo(q, Object.keys(sent)).cls }, q.id);
      b.addEventListener("click", function () { var a = findAnchor(q.id); if (a) { a.scrollIntoView({ block: "center" }); openPop(q, a); } });
      p.append(b);
    });
    var orphans = orphanQuestions(QUESTIONS, textIds(), DIAGRAMS);
    if (orphans.length) p.append(el("span", { class: "warn" }, "置き場所が無い問い：" + orphans.join("、")));
  }

  function findAnchor(id) { return document.querySelector('[data-qid="' + id + '"]'); }

  function placeMarkers() {
    document.querySelectorAll(".mk[data-qid], .mk-svg").forEach(function (n) { n.remove(); });
    var sentIds = Object.keys(sent);
    document.querySelectorAll("[data-q]").forEach(function (host) {
      if (host.closest("svg")) return;
      var after = host;
      idsOf(host.getAttribute("data-q")).forEach(function (id) {
        var q = byQ[id]; if (!q) { console.warn("問いのデータが無い:", id); return; }
        var info = markerInfo(q, sentIds);
        var b = el("button", { type: "button", class: "mk " + info.cls, "data-qid": id, "aria-label": id + " " + info.text + "：" + q.title }, id + " " + info.mark);
        b.addEventListener("click", function () { openPop(q, b); });
        after.after(b); after = b;
      });
    });
    document.querySelectorAll("svg g.node[data-q]").forEach(function (g) {
      var box = g.firstElementChild.getBBox(), x = box.x + box.width - 6;
      idsOf(g.getAttribute("data-q")).forEach(function (id) {
        var q = byQ[id]; if (!q) { console.warn("問いのデータが無い:", id); return; }
        var info = markerInfo(q, sentIds), label = id + " " + info.mark, w = 16 + label.length * 7.5;
        var m = document.createElementNS("http://www.w3.org/2000/svg", "g");
        m.setAttribute("class", "mk-svg " + info.cls); m.setAttribute("data-qid", id);
        m.setAttribute("role", "button"); m.setAttribute("tabindex", "0"); m.setAttribute("aria-label", id + " " + info.text + "：" + q.title);
        var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("x", x); r.setAttribute("y", box.y - 12); r.setAttribute("width", w); r.setAttribute("height", 20); r.setAttribute("rx", 10);
        r.setAttribute("fill", "var(--paper)"); r.setAttribute("stroke", "currentColor"); r.setAttribute("stroke-width", 1.5);
        var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", x + w / 2); t.setAttribute("y", box.y + 2); t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", 11);
        t.setAttribute("style", "fill: currentColor; font-family: var(--font-mono); font-weight: 600"); t.textContent = label;
        m.append(r, t);
        var open = function () { openPop(q, m); };
        m.addEventListener("click", open);
        m.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
        g.parentNode.append(m); x += w + 4;
      });
    });
  }

  function refresh() { window.drawDiagrams(); placeMarkers(); renderProgress(); }

  function position() {
    if (!current) return;
    if (window.innerWidth < 640) { pop.classList.add("sheet"); pop.style.left = pop.style.top = ""; return; }
    pop.classList.remove("sheet");
    var r = current.anchor.getBoundingClientRect(), pw = Math.min(520, window.innerWidth - 32);
    var left = Math.min(Math.max(16, r.left), window.innerWidth - pw - 16) + window.scrollX;
    pop.style.width = pw + "px"; pop.style.left = left + "px"; pop.style.top = (r.bottom + window.scrollY + 8) + "px";
  }

  function closePop() {
    if (!current) return;
    var a = current.anchor; current = null; pop.hidden = true; pop.replaceChildren();
    var again = findAnchor(a.getAttribute("data-qid")); if (again && again.focus) again.focus();
  }

  function details(q) {
    var d = el("details"); d.append(el("summary", null, "問いの詳細"));
    d.append(el("div", null, (q.situation || "") + (q.example || "")));
    var ul = el("ul"); q.options.forEach(function (o) { ul.append(el("li", null, "<strong>" + o.key + "「" + o.label + "」</strong>：" + (o.effect || ""))); });
    d.append(ul); return d;
  }

  function renderPop(q) {
    var info = markerInfo(q, Object.keys(sent)), box = el("div");
    var head = el("div", { class: "pop-head" });
    head.append(el("span", { class: "mk " + info.cls }, q.id + " " + info.mark), el("span", { class: "t" }, q.title));
    var x = el("button", { type: "button", class: "x", "aria-label": "閉じる" }, "×"); x.addEventListener("click", closePop); head.append(x);
    box.append(head);

    if (q.status === "done") { box.append(el("div", { class: "answer" }, q.answer || "決定済み"), details(q)); return box; }
    if (q.status === "revoked") {
      var rv = el("div", { class: "revoked" }, "<strong>取り消し</strong>：" + (q.revokedWhy || "") + (q.revokedBy ? " → " : ""));
      if (q.revokedBy && byQ[q.revokedBy]) {
        var go = el("button", { type: "button", class: "btn ghost" }, q.revokedBy + " を開く");
        go.addEventListener("click", function () { var a = findAnchor(q.revokedBy); if (a) openPop(byQ[q.revokedBy], a); });
        rv.append(go);
      }
      box.append(rv, details(q)); return box;
    }
    if (sent[q.id]) {
      box.append(el("p", { class: "note" }, "送信済み（" + sent[q.id] + "）。Claude が反映すると決定に変わります。"));
      var again = el("details"); again.append(el("summary", null, "送り直す・詳細を見る")); box.append(again);
      box = again;
    }
    if (q.status === "recheck") box.append(el("div", { class: "recheck" }, "<strong>要確認</strong>：" + (q.recheckWhy || "")));
    box.append(el("div", null, (q.situation || "") + (q.example || "")));

    var group = el("div", { role: "radiogroup", "aria-label": "選択肢" });
    q.options.forEach(function (o) {
      var id = "opt-" + q.id + "-" + o.key, lab = el("label", { class: "opt", for: id });
      var input = el("input", { type: "radio", name: "opt-" + q.id, id: id, value: o.key });
      var t = el("span", null, "<strong>" + o.key + "「" + o.label + "」</strong>");
      if (o.key === q.recommended) t.append(el("span", { class: "rec" }, "推奨"));
      lab.append(input, t, el("span", { class: "eff" }, o.effect || "")); group.append(lab);
    });
    box.append(group);
    if (q.recommendWhy) box.append(el("p", { class: "note" }, "推奨の理由：" + q.recommendWhy));
    var noteId = "note-" + q.id; box.append(el("label", { for: noteId, class: "note" }, "補足（任意）"));
    var note = el("textarea", { id: noteId, maxlength: "1500" }); box.append(note);
    var askId = "ask-" + q.id, askWrap = el("div"); askWrap.hidden = true;
    askWrap.append(el("label", { for: askId, class: "note" }, "判断に足りない文脈・質問"));
    var ask = el("textarea", { id: askId, maxlength: "1500" }); askWrap.append(ask); box.append(askWrap);
    var sendBtn = el("button", { type: "button", class: "btn" }, "回答を送る");
    var askBtn = el("button", { type: "button", class: "btn ghost" }, "文脈が足りない：質問する");
    var btns = el("div", { class: "btns" }); btns.append(sendBtn, askBtn); box.append(btns);
    var msg = el("div", { class: "msg", role: "status" }); box.append(msg);
    var fb = el("div"); fb.hidden = true;
    var fbText = el("textarea", { readonly: "", "aria-label": "チャットに貼る文面" });
    var copy = el("button", { type: "button", class: "btn ghost" }, "文面をコピー");
    copy.addEventListener("click", function () {
      navigator.clipboard.writeText(fbText.value).then(function () { msg.className = "msg"; msg.textContent = "コピーしました。チャットに貼ってください。"; },
        function () { fbText.focus(); fbText.select(); msg.className = "msg"; msg.textContent = "選択しました。コピーしてチャットに貼ってください。"; });
    });
    fb.append(fbText, copy); box.append(fb);
    var ui = { msg: msg, fb: fb, fbText: fbText, busy: function (on) { sendBtn.disabled = askBtn.disabled = on; } };

    sendBtn.addEventListener("click", function () {
      var picked = group.querySelector("input:checked");
      if (!picked) { msg.className = "msg err"; msg.textContent = "選択肢を 1 つ選んでください。"; return; }
      var body = answerBody(q, picked.value, note.value);
      send(q, buildMessage(PAGE.tag, q, "への回答", body), "選択：" + picked.value, ui);
    });
    askBtn.addEventListener("click", function () {
      if (askWrap.hidden) { askWrap.hidden = false; askBtn.textContent = "質問を送る"; ask.focus(); return; }
      var t = ask.value.trim();
      if (!t) { msg.className = "msg err"; msg.textContent = "質問を書いてください。"; return; }
      send(q, buildMessage(PAGE.tag, q, "について質問", t), null, ui);
    });
    return head.parentNode;
  }

  function showFallback(ui, text, reason) {
    ui.fbText.value = text; ui.fb.hidden = false;
    ui.msg.className = "msg err"; ui.msg.textContent = reason;
  }

  function safeState() { return api.canSendToClaude().catch(function () { return "off"; }); }

  async function send(q, text, summary, ui) {
    var anchorEl = current.anchor; /* await 中にポップオーバーが閉じられても使えるよう先に取る */
    ui.msg.textContent = ""; ui.fb.hidden = true;
    if (api) sendState = await safeState();
    if (!api || sendState !== "available") { showFallback(ui, text, STATE_TEXT[sendState] || STATE_TEXT.off); return; }
    ui.busy(true); ui.msg.className = "msg"; ui.msg.textContent = "送信中…（初回は許可の確認が出ます）";
    try {
      var anchor = await api.anchorFor(anchorEl);
      await api.sendToClaude({ anchor: anchor, text: text });
      if (summary) { sent[q.id] = summary; saveSent(); closePop(); refresh(); }
      else { ui.msg.textContent = "質問を送りました。答えは本文の補足と、このスレッドに届きます。"; }
    } catch (e) {
      var code = e && e.code;
      showFallback(ui, text, ERROR_TEXT[code] || ("送れませんでした（" + (code || "error") + "）。下の文面をコピーしてチャットに貼ってください。"));
      if (code === "rate_limited") ui.fb.hidden = true;
    } finally { ui.busy(false); }
  }

  function openPop(q, anchor) {
    current = { q: q, anchor: anchor };
    pop.replaceChildren(renderPop(q)); pop.hidden = false; position();
    var f = pop.querySelector("input, textarea, button"); if (f) f.focus();
  }

  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closePop(); });
  document.addEventListener("click", function (ev) {
    if (!current || pop.contains(ev.target) || current.anchor.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest(".mk, .mk-svg, .progress")) return;
    closePop();
  });
  window.addEventListener("resize", position);

  refresh();
  (async function () {
    try { api = window.claude && window.claude.use ? await window.claude.use("comments") : null; } catch (e) { api = null; }
    sendState = api ? await safeState() : "none";
  })();
```

`renderPop` の末尾は、送信済みのとき `box` が `<details>` に替わる。そのため外側の要素を返すように、`return head.parentNode;` にしている。`head` は最初の `box` に入れてあるので、`head.parentNode` が外側の要素になる。

- [ ] **Step 3: 単体テストと構文を確かめる**

Run: Task 2 の Step 4 と同じコマンド。
Expected: テストが PASS し、`core OK` `data OK` `ui OK` が出る。

- [ ] **Step 4: ブラウザで操作して確かめる（Review Focus 3・4・5）**

Task 2 の Step 5 と同じく `ab-template` のプレビューで開き直し（再読み込み）、次を確かめる。

1. 本文の「いつ保存するか」の後ろに `Q0 ✓`（緑）、「エラーの出し方」の後ろに `Q2 !`（注意色）の目印がある。
2. 図のひし形の右上に `Q1 ×`（取り消し線）と `Q1R ?`（強調色）が横に並ぶ。
3. `Q1R` を押すと、ひし形の下にポップオーバーが開く。中身は状況・具体例の表・選択肢・推奨・補足・ボタン。Esc と外側のクリックで閉じる。
4. `Q1` を押すと「取り消し：…→ Q1R を開く」が出て、そのボタンで Q1R に移る。
5. `Q1R` で a を選んで「回答を送る」を押す。ローカルでは `window.claude` が無いので、「コメント機能が使えません」と文面のコピー欄が出る。文面が `[壁打ち] Q1R「自動保存の間隔をどうするか」への回答\n選択：a「1 秒待ってまとめる」` で始まっている。
6. 「文脈が足りない：質問する」を 1 回押すと入力欄が出て、2 回目で同じくコピー欄が出る。
7. 上部の行が `決定 1 ／ 回答待ち 1 ／ 要確認 1` で、`Q1R` と `Q2` のボタンがある。
8. data の `QUESTIONS` に `{ id: "Q5", status: "open", title: "仮", situation: "", options: [{key:"a",label:"x",effect:""}], recommended: "a", recommendWhy: "" }` を一時的に足すと、上部に「置き場所が無い問い：Q5」が出る。確かめたら消す。
9. 幅 375px（resize_window の mobile）ではポップオーバーが画面下から出る。ダーク表示で文字と背景が読める。

- [ ] **Step 5: Artifact 上で送信を確かめる**

1. scratchpad にコピーした page.html を、`capabilities: {"comments": {}}` を付けて非公開で publish する。
2. `ArtifactComments` の watch を有効にする。
3. ユーザーに Q1R から 1 回送ってもらう。
4. このセッションに通知が届き、スレッドの本文が手順 5 の形式になっていることを確かめる。
5. ページではポップオーバーが閉じ、目印が `Q1R …`（送信済み）に変わっていることを確かめる。
6. 確かめたら watch を止める。

- [ ] **Step 6: コミット**

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'feat: markers, popover questions, collapse and send fallback\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: references/questions.md

**Files:**
- Create: `~/.claude/skills/artifact-brainstorming/references/questions.md`

**Interfaces:**
- Consumes: Task 3 のページの約束事（`data-q`、ノードの `q`、question の形、状態 4 種）
- Produces: SKILL.md が「問いを出すときはこれを読む」と参照するファイル。

- [ ] **Step 1: 書く**

```markdown
# 問いの書き方と置き場所

## 1 問の中身（この順に書く）

1. **状況**（`situation`）: いま何が起きていて、なぜこれを決める必要があるか。2〜4 文。
2. **具体例の表**（`example`）: ケースを抽象的に書かない。「手順・今・変えた後」や「案・画面で見えること・良い点・弱い点」の表にする。図で示せるなら、本文に図を足してリンクする。
3. **選択肢**（`options`）: 2〜3 個。`effect` に「どこが変わって何が起きるか」を書く。
4. **推奨と理由**（`recommended` / `recommendWhy`）: 必ず付ける。白紙で問わない。

調べれば分かる事実は問わない。自分で調べて状況に書く。問うのは決定だけ。

## 置き場所

- 問いは、判断に要る文脈の中に目印として置く。問いをセクションに並べない。
  - 本文の言葉: `<span data-q="Q3">その言葉</span>`
  - 図のノード: `{ ..., q: "Q3" }`
- 全体に関わる問い（目的・前提の確認など）も、意図が最も近い文言に置く（例：「目的」の段落の言葉）。
- 意図に近い文脈が図解のどこにも無いときは、先に関係する章へ段落・図・表を足し（無ければ章を新設）、そこに置く。
- 参照は文末にまとめず、本文の言葉そのものをリンクにする（例：「<a href="#fig-save">保存の流れの図</a>のとおり」）。

## 状態

| status | 使うとき | 書くもの |
|---|---|---|
| `open` | 回答待ち | 上の 4 つ |
| `done` | 回答を受けて決めた | `answer` に「決定：a「…」」と、決めたことで何が決まったか |
| `revoked` | 決めた後に前提が崩れて取り消した | `revokedWhy`（理由）と `revokedBy`（作り直した問いの id） |
| `recheck` | 取り消した決定に乗っていた後続の問い | `recheckWhy`（何を見直すか） |

## 取り消して作り直すとき

1. 元の問いを `revoked` にし、`revokedWhy` と `revokedBy` を書く。データからは消さない。
2. 作り直した問い（id は元の id に `R` を付ける。例：`Q3R`）を、元の問いと同じ目印の場所に並べる（`data-q="Q3 Q3R"` / `q: "Q3 Q3R"`）。
3. 元の決定を前提にしていた後続の問いを `recheck` にする。

## 設計の節の承認

設計の節ごとに、同じ形の問いを節の見出しか最初の文言に置く。

- 選択肢は a「この内容で OK」と b「修正あり（補足に書く）」の 2 つ。
- 節の本文から根拠の図・決定へは、文中リンクを張る。

## チャットで問うとき

チャット（AskUserQuestion）で問う場面もある。memo 4 の分かれ道や設計書の置き場所などである。そのときは、直前の本文は読まれていないものとして書く。質問文に「状況 → 具体例 → 決めること」を入れ、選択肢の説明に結果を書く。
```

- [ ] **Step 2: ページの約束事と食い違いが無いか確かめる**

Run: `grep -n 'data-q\|revokedBy\|recheckWhy\|recommendWhy' ~/.claude/skills/artifact-brainstorming/references/questions.md ~/.claude/skills/artifact-brainstorming/templates/page.html | head -40`
Expected: questions.md に出てくるフィールド名が、page.html の data と ui に同じ綴りで出てくる。

- [ ] **Step 3: コミット**

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'docs: how to write and place questions\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 5: references/loop.md

**Files:**
- Create: `~/.claude/skills/artifact-brainstorming/references/loop.md`

**Interfaces:**
- Consumes: Task 3 の送信文の形式。Artifact / ArtifactComments の各ツール。
- Produces: SKILL.md が「ページから届いたらこれを読む」と参照するファイル。

- [ ] **Step 1: 書く**

```markdown
# 受け取りループと、うまくいかないとき

## ループ（ページから送られるたびに）

1. 通知（`artifact-auto-react`）を受けたら、`ArtifactComments` の `read` を、スレッドを指定せずに呼んで全スレッドを読む。通知は 1 件ずつ来るが、他にも未処理が残っていることがある。
2. 届いたものを 3 種類に分ける。
   - 問いへの回答: 本文が `[タグ] ID「題」への回答` で始まる。
   - 「文脈が足りない」質問: `[タグ] ID「題」について質問` で始まる。
   - 普通のコメント: それ以外（図の文言の指摘など）。
3. 種類ごとに直す。
   - 回答: その問いを `done` にして `answer` を書く。図の決定表示（ノードのラベルなど）を直す。次の問いを 1 つだけ `open` で足す。
   - 質問: 問いの近くの本文に補足（段落・図・具体例の表）を足す。問いは `open` のまま。
   - 普通のコメント: 指摘どおり本文を直す。
4. スレッドの自動返信を読み、実際の対応と見比べる。
   - 食い違っていたら（約束・見通し・余計な質問）、訂正を 1 行 `reply` する。
   - 同じなら何も書かない。質問への補足でも、自動返信が足した場所を伝えていれば書かない。
   - 自動返信が約束したことは、実行するか訂正する。
5. ページの 3 つのスクリプト（core / data / ui）の構文を `node --check` で確かめてから、同じファイルパスで publish する。`label` は「Q3 決定・Q4 追加」の形にする。
6. 済んだスレッドを `resolve` する。やりとりが続いているものは開いたままにする。
7. チャットには 1〜2 行だけ書く: 「Q3 を a で決定。次の Q4 は〈言葉〉の目印に置きました」とリンク。

## うまくいかないとき

| 場面 | どうするか |
|---|---|
| ページから送れない | ページが理由とコピー用の文面を出す。ユーザーがチャットに貼ったら、ページから届いたときと同じループで処理する |
| 決めた問いの前提が崩れた（外部レビューやユーザーの深掘りで） | `questions.md` の「取り消して作り直すとき」の手順 |
| publish したら、他で公開された新しい版があった | 上書きしない。別のセッションが処理していないか確かめる。していれば自分の見張りを止める（`ArtifactComments` の watch を off）。していなければ、新しい版を読み直して自分の変更を重ねて publish する |
| コンテキストが溜まった | 下の引き継ぎ手順 |

## 引き継ぎ

1. アーティファクトの URL と、ページの data（決定・未決の問い）を正とする。引き継ぎ書には次だけを書く。
   - 方針
   - 途中の議論
   - ページに載っていない約束
   - 元のセッションの transcript の場所
2. 自分の見張りを止める（`ArtifactComments` の watch を off）。
3. ユーザーに新しいセッションを起動してもらう。起動方法はユーザーの環境に任せる（orca など）。
4. 新しいセッションでは、アーティファクトを `read` してから watch を始める。全スレッドを読んで未処理を確かめる。

## 終わるとき

writing-plans に移る時点で、見張りを止める。以降にページから送られても受け取らない。
```

- [ ] **Step 2: 送信文の形式が page.html と一致するか確かめる**

Run: `grep -n 'への回答\|について質問' ~/.claude/skills/artifact-brainstorming/references/loop.md ~/.claude/skills/artifact-brainstorming/templates/page.html`
Expected: loop.md の 2 つの形式が、page.html の `buildMessage` の呼び出し（`"への回答"` と `"について質問"`）と一致する。

- [ ] **Step 3: コミット**

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'docs: receive loop, failures and handoff\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 6: SKILL.md と writing-skills による仕上げ

**Files:**
- Create: `~/.claude/skills/artifact-brainstorming/SKILL.md`

**Interfaces:**
- Consumes: Task 3 の templates/page.html、Task 4 の references/questions.md、Task 5 の references/loop.md
- Produces: skill の入口。

- [ ] **Step 1: writing-skills を読む**

Skill ツールで `superpowers:writing-skills` を読み込む。次の決まりを確かめる。
- frontmatter（`name`・`description`）の書き方
- 説明文に「いつ使うか」だけを書くこと
- 本文の長さの目安

以下の Step 2 の文面が決まりに合わなければ、決まりに合わせて直す。ただし、Global Constraints の内容（名前で呼んだときだけ起動、など）は変えない。

- [ ] **Step 2: 書く**

```markdown
---
name: artifact-brainstorming
description: Use only when the user types /artifact-brainstorming or explicitly asks to run brainstorming on an artifact (「アーティファクトで壁打ちして」). Never use automatically for ordinary brainstorming.
---

# Artifact Brainstorming

superpowers:brainstorming の段階はそのまま使う。この skill は、問い・承認・設計の提示を行う場所を、図解アーティファクトの目印とポップオーバーに移すだけのもの。分類・案の比較・設計書・writing-plans への受け渡しは brainstorming に従う。手順はここに書き写さない。

## 流れ

1. **起動**: superpowers:brainstorming を起動し、分類（spike / bounded / architectural）を宣言する。
2. **図解を作る**: 対象の流れと前提を章と図でまとめる。規模に応じて薄くし、小さい題なら 1 章・図 1 枚程度にする。
   - `templates/page.html` をコピーし、本文・`PAGE`・`DIAGRAMS`・`QUESTIONS` だけを書き換える。図は Mermaid を使わず、`DIAGRAMS` に書く。
   - `capabilities: {"comments": {}}` を付けて publish し、`ArtifactComments` の watch を始める。
   - チャットには 1〜2 行とリンクだけ書く。
3. **理解の質疑**: ユーザーが疑問を解消する時間を取る。答えは本文に足す。「進めて」の合図を待つ。
4. **Q0**: 目的・成功基準・仮定（ユーザーが言ったことと仮定を分けて）を、図解の「目的」の言葉の目印に出す。
5. **分岐を 1 問ずつ**: 親の分岐から順に出す。書き方と置き場所は `references/questions.md` に従う。案の比較（2〜3 案）も、比較表付きの問いとして出す。
6. **ページから届いたら**: `references/loop.md` のループを回す。
7. **設計**: 図解に「設計」の章を足し、節ごとに出して承認の問いを置く。各節から根拠へ文中リンクを張る。
8. **設計書**: brainstorming の決まりどおりの場所に書く。ユーザーの指定があればそちらに書く。
9. **分かれ道**: 「チャットに戻る」か「アーティファクトで続ける」かを、チャットで聞く。続けるなら、設計書の要点を図解に載せ、確認と承認までをアーティファクトで行う。
10. **実装計画へ**: チャットで writing-plans を起動し、見張りを止める。

## 常に守ること

- 問いは 1 問ずつ出す。問いは必ず文脈の中の目印に置き、セクションに並べない。
- 調べれば分かる事実は問わない。
- ケースは最初から具体例の表で示す。
- チャットに書くのは、回答のたびに 1〜2 行とリンクだけ。
- 外部レビュー（Codex・Opus など）は、この skill の手順には入れない。ユーザーが指示したら行う。崩れた決定は、取り消しの手順で扱う。
- コンテキストが溜まったら、`references/loop.md` の引き継ぎ手順に従う。
```

- [ ] **Step 3: skill として認識されるか確かめる**

Run: `head -5 ~/.claude/skills/artifact-brainstorming/SKILL.md && /bin/ls ~/.claude-hb/skills/artifact-brainstorming/SKILL.md ~/.claude-private/skills/artifact-brainstorming/SKILL.md`
Expected: frontmatter が出て、hb・private 側からも SKILL.md が見える。

- [ ] **Step 4: コミット**

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'feat: SKILL.md entry point\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 7: 通しの試運転（ユーザーと一緒に）

**Files:**
- 試運転の結果で直すファイル（SKILL.md / references / templates のいずれか）

**Interfaces:**
- Consumes: Task 1〜6 のすべて

- [ ] **Step 1: 新しいセッションで起動する**

ユーザーに新しいセッションを開いてもらい、小さな題で `/artifact-brainstorming` を使ってもらう。題の例は「`~/develop` にある小さなツールへの機能追加」。このセッションは transcript を読んで観察する。

- [ ] **Step 2: 確かめる（設計書 §5-2）**

- 起動 → 図解 → 質疑 → Q0 → 2〜3 問 → 設計 1 節 → 設計書 → 分かれ道、の順に進むか
- 図解が Mermaid ではなくテンプレートの SVG で描かれているか
- チャットに書く量が回答のたびに 1〜2 行か
- 問いが文脈の中の目印から開くか

- [ ] **Step 3: うまくいかない場面を確かめる（設計書 §5-3）**

試運転の途中で、ユーザーに次を 1 回ずつしてもらう。
- 1 問を取り消してもらう。元の問いが取り消し線で残り、作り直した問いが同じ場所に並び、後続の問いが「要確認」になるか。
- 見張りを止めた状態で送ってもらう。ページに理由とコピー欄が出るか。
- 引き継ぎを 1 回してもらう。古いセッションの見張りが止まり、新しいセッションで再開するか。

- [ ] **Step 4: 見つかった問題を直してコミットする**

問題ごとに、該当ファイルを直す。templates を直したら Task 2 の Step 4 のコマンドで確かめ、次でコミットする。

```bash
cd ~/.claude/skills/artifact-brainstorming && git add -A && git commit -m "$(printf 'fix: adjustments from end-to-end trial\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```
