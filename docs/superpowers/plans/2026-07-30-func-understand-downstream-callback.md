# func-understand 下流コールバック名前渡し検出 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `items.map(helper)` のように引数位置へ名前渡しされたリポ内定義関数を下流ノードとして発見し、`callback-passed` エッジ付きでグラフに載せる(issue #9)。

**Architecture:** CLI パイプラインを `buildGraph` → `addDownstreamCallbacks`(新設) → `addCallbackEdges` の3段にする。新パスは「下流側ノードの本体 AST から引数位置の関数参照を発見してノード化する」ことだけを担い、エッジの網羅(上流方向)は既存の `addCallbackEdges` が新ノードを自動的に拾う。スペック: `docs/superpowers/specs/2026-07-30-func-understand-downstream-callback-design.md`

**Tech Stack:** Node.js (ESM, `node --test`), TypeScript LanguageService(`getDefinitionAtPosition` / Call Hierarchy)

## Global Constraints

- 作業ディレクトリ: `plugins/cc-func-understand/skills/func-understand/scripts/`(以下、ファイルパスはここからの相対。テスト実行もこのディレクトリで行う)
- テスト実行: `npm test`(= `node --test "test/*.test.mjs"`)。全タスクで既存テストが green のままであること
- 検出範囲は「CallExpression / NewExpression の引数位置にある Identifier / PropertyAccessExpression」のみ。オブジェクト/配列リテラル内・代入・return 位置は対象外(スペックのユーザー決定)
- エッジ方向は既存 `callback-passed` の意味論と同じ「渡す側(包含関数) → 渡される関数」
- コード内コメントは日本語、既存ファイルの文体・密度に合わせる

---

### Task 1: 発見パス本体(`lib/downstream-callbacks.mjs`)+ fixture

**Files:**
- Create: `test/fixtures/downstream-callback/tsconfig.json`
- Create: `test/fixtures/downstream-callback/src/helpers.ts`
- Create: `test/fixtures/downstream-callback/src/register.ts`
- Create: `test/fixtures/downstream-callback/src/excluded.ts`
- Create: `test/fixtures/downstream-callback/src/main.ts`
- Create: `lib/downstream-callbacks.mjs`
- Modify: `lib/graph-builder.mjs`(`continueDownstream` を `continueUpstream` の直後に追加)
- Test: `test/downstream-callbacks.test.mjs`

**Interfaces:**
- Consumes: `graph-builder.mjs` の `graph._ctx`(nodes / edges / prepare / itemToNode / upsertEdge / isFileExcluded / maxNodes / downstreamDepth / visitedDown)、`target-resolver.mjs` の `collectDeclarations(ts, proj)`
- Produces:
  - `addDownstreamCallbacks(ts, proj, graph, { projectRoot })` → graph(`lib/downstream-callbacks.mjs` の named export。Task 3 で CLI が使う)
  - `continueDownstream(ts, proj, graph, startEntries)` → graph(`lib/graph-builder.mjs` の named export。startEntries は `[{ node, item, depth }]`)

- [ ] **Step 1: fixture を作成する**

`test/fixtures/downstream-callback/tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" }, "include": ["src"] }
```

`test/fixtures/downstream-callback/src/helpers.ts`:

```ts
export function helper(x: string): string {
  return normalize(x);            // helper の下流継続確認用(direct-call)
}

export function normalize(x: string): string {
  return x.trim();
}

export const utils = {
  fmt(x: string): string {
    return `[${x}]`;
  },
};
```

`test/fixtures/downstream-callback/src/register.ts`:

```ts
export type Fn = (x: string) => string;
const registry = new Map<string, Fn>();

export function register(name: string, fn: Fn): void {
  registry.set(name, fn);
}
```

`test/fixtures/downstream-callback/src/excluded.ts`:

```ts
export function exHelper(x: string): string {
  return x.toLowerCase();
}
```

`test/fixtures/downstream-callback/src/main.ts`:

```ts
import { helper, utils } from "./helpers.js";
import { register, type Fn } from "./register.js";
import { exHelper } from "./excluded.js";

export function target(items: string[]): string {
  const mapped = items.map(helper);     // 裸 Identifier の名前渡し(発見対象)
  const fmted = items.map(utils.fmt);   // PropertyAccess(outgoing calls で既検出 → 二重計上しない)
  register("t", helper);                // 自作関数経由の名前渡し(同じ helper への別行参照)
  return [...mapped, ...fmted].join("\n");
}

export function otherUser(items: string[]): string[] {
  return items.map(helper);             // 後段 addCallbackEdges による上流検出の確認用
}

export function applyEach(items: string[], cb: Fn): string[] {
  return items.map(cb);                 // パラメータ渡し(誤検出されないこと)
}

export function usesExcluded(items: string[]): string[] {
  return items.map(exHelper);           // テスト除外時に発見されないこと(Task 2)
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/downstream-callbacks.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';
import { buildGraph } from '../lib/graph-builder.mjs';
import { addDownstreamCallbacks } from '../lib/downstream-callbacks.mjs';
import { addCallbackEdges } from '../lib/callback-edges.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, 'fixtures/downstream-callback');
const { ts } = loadTypeScript(path.join(here, '..'));

function analyze(fn, buildOpts = {}, { withUpstreamPass = true } = {}) {
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: fn }, projectRoot);
  let g = buildGraph(ts, proj, r.declaration, { projectRoot, ...buildOpts });
  g = addDownstreamCallbacks(ts, proj, g, { projectRoot });
  if (withUpstreamPass) g = addCallbackEdges(ts, proj, g, { projectRoot });
  return g;
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);
const edgesBetween = (g, from, to) => g.edges.filter((e) => e.from === from.id && e.to === to.id);

test('items.map(helper) の helper が下流ノード + callback-passed エッジになる', () => {
  const g = analyze('target');
  const target = byName(g, 'target');
  const helper = byName(g, 'helper');
  assert.ok(helper, '名前渡しされた helper がノード化される');
  assert.equal(helper.downstreamDistance, 1);
  const cb = edgesBetween(g, target, helper).filter((e) => e.kind === 'callback-passed');
  assert.equal(cb.length, 1);
});

test('map(helper) と register("t", helper) の2箇所が1本のエッジに行マージされる', () => {
  const g = analyze('target');
  const cb = edgesBetween(g, byName(g, 'target'), byName(g, 'helper')).find((e) => e.kind === 'callback-passed');
  assert.equal(cb.callLines.length, 2, 'map 行と register 行の両方が記録される');
});

test('items.map(utils.fmt) は direct-call のみで callback-passed と二重計上されない', () => {
  const g = analyze('target');
  const edges = edgesBetween(g, byName(g, 'target'), byName(g, 'fmt'));
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, 'direct-call');
});

test('発見された helper の下流(normalize)が direct-call で継続探索される', () => {
  const g = analyze('target');
  const normalize = byName(g, 'normalize');
  assert.ok(normalize, 'helper が呼ぶ normalize もノード化される');
  assert.equal(normalize.downstreamDistance, 2);
  const edges = edgesBetween(g, byName(g, 'helper'), normalize);
  assert.equal(edges[0].kind, 'direct-call');
});

test('後段 addCallbackEdges が新ノード helper への上流(otherUser)も検出する', () => {
  const g = analyze('target');
  const otherUser = byName(g, 'otherUser');
  assert.ok(otherUser, '同じ helper を渡す otherUser が上流ノード化される');
  const cb = edgesBetween(g, otherUser, byName(g, 'helper')).filter((e) => e.kind === 'callback-passed');
  assert.equal(cb.length, 1);
});

test('パラメータの名前渡し items.map(cb) は誤検出されない', () => {
  const g = analyze('applyEach');
  assert.ok(!byName(g, 'cb'), 'パラメータはリポ内関数宣言に解決されないため落ちる');
  assert.equal(g.nodes.filter((n) => n.internal).length, 1, 'applyEach 自身のみ');
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: `test/downstream-callbacks.test.mjs` が `Cannot find module '../lib/downstream-callbacks.mjs'` で FAIL、既存テストは PASS

- [ ] **Step 4: `continueDownstream` を `lib/graph-builder.mjs` に追加する**

`continueUpstream`(graph-builder.mjs 241〜249行)の直後に追加:

```js
/**
 * 下流方向(呼び出し先)の Call Hierarchy BFS を `startEntries` から再開/継続する。
 * addDownstreamCallbacks が発見した「名前渡しされた関数」ノードからの下流継続に使う。
 * continueUpstream の鏡像(stepDirection と visitedDown を共有)。
 */
export function continueDownstream(ts, proj, graph, startEntries) {
  const ctx = graph._ctx;
  const queue = [...startEntries];
  for (const entry of queue) ctx.visitedDown.add(entry.node.id);
  while (queue.length) {
    stepDirection(ts, proj, ctx, 'down', queue.shift(), queue);
  }
  return syncGraph(graph);
}
```

- [ ] **Step 5: `lib/downstream-callbacks.mjs` を実装する**

```js
import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';
import { continueDownstream, syncGraph } from './graph-builder.mjs';

const SCAN_KINDS = new Set(['function', 'method', 'arrow']);

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * ソースファイル全体から CallExpression / NewExpression の引数位置に現れる
 * Identifier / PropertyAccessExpression を収集する。PropertyAccess は
 * getDefinitionAtPosition で正しく解決できるよう `.name` 側の Identifier を返す。
 * どのノードの本体に属するかの帰属はここでは行わない(呼び出し側が最内包含宣言で判定)。
 */
function collectArgRefs(ts, sourceFile) {
  const refs = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) {
        if (ts.isIdentifier(arg)) refs.push(arg);
        else if (ts.isPropertyAccessExpression(arg)) refs.push(arg.name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return refs;
}

/**
 * 下流側ノード(downstreamDistance を持つ内部関数様ノード)の本体から、
 * 引数位置に名前渡しされたリポ内定義関数を発見してノード化する後段パス。
 * エッジの網羅(上流方向)は後段の addCallbackEdges が新ノードも拾うため、
 * ここでは「発見 + 包含ノード→被渡し関数の callback-passed + 下流継続」のみ行う。
 * スペック: docs/superpowers/specs/2026-07-30-func-understand-downstream-callback-design.md
 */
export function addDownstreamCallbacks(ts, proj, graph, opts) {
  const { projectRoot } = opts;
  const ctx = graph._ctx;
  if (!ctx) throw new Error('addDownstreamCallbacks には buildGraph が返した graph(内部コンテキスト付き)が必要です');

  const decls = collectDeclarations(ts, proj).map((d) => ({ ...d, relFile: path.relative(projectRoot, d.file) }));
  const declByKey = new Map(decls.map((d) => [`${d.file}#${d.selectionStart}`, d]));
  const argRefsByFile = new Map(); // fileName -> collectArgRefs の結果(ファイル単位でキャッシュ)

  // 参照行を含む最内の関数様宣言の id を返す(callback-edges.mjs の findEnclosingDecl と同じ行ベース判定)
  const findEnclosingDeclId = (relFile, line) => {
    const candidates = decls.filter((d) => d.relFile === relFile && d.startLine <= line && line <= d.endLine);
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
    return `${candidates[0].relFile}#${candidates[0].selectionStart}`;
  };

  const isScannable = (node) => node.internal && SCAN_KINDS.has(node.kind) && node.downstreamDistance != null;

  const queue = [];
  const queued = new Set();
  const enqueue = (node) => {
    if (isScannable(node) && !queued.has(node.id)) {
      queued.add(node.id);
      queue.push(node);
    }
  };
  for (const node of ctx.nodes.values()) enqueue(node);

  while (queue.length) {
    const node = queue.shift();

    const sf = proj.program.getSourceFile(node._selection.file);
    if (!sf) continue;
    if (!argRefsByFile.has(sf.fileName)) argRefsByFile.set(sf.fileName, collectArgRefs(ts, sf));

    for (const refIdent of argRefsByFile.get(sf.fileName)) {
      const refPos = refIdent.getStart(sf);
      const refLine = lineOf(sf, refPos);
      // このノード自身の本体内の参照だけを扱う(ネストした名前付き関数内の参照は、
      // その関数がノード化されてスキャンされるときに扱う)
      if (findEnclosingDeclId(node.file, refLine) !== node.id) continue;

      const defs = proj.service.getDefinitionAtPosition(sf.fileName, refPos) ?? [];
      for (const def of defs) {
        const decl = declByKey.get(`${def.fileName}#${def.textSpan.start}`);
        if (!decl) continue; // リポ内の関数様宣言に解決できない(パラメータ・変数・外部・stdlib 等)

        const calleeId = `${decl.relFile}#${decl.selectionStart}`;

        // direct-call との二重計上防止: 同じ from→to の direct-call が同一行を記録済みならスキップ
        // (items.map(utils.fmt) のような PropertyAccess は outgoing calls が既に検出している)
        const dc = ctx.edges.get(`${node.id}->${calleeId}#direct-call`);
        if (dc && dc.callLines.includes(refLine)) continue;

        const item = ctx.prepare(decl.file, decl.selectionStart);
        if (!item) continue;
        const calleeNode = ctx.itemToNode(item);

        ctx.upsertEdge(node.id, calleeNode.id, 'callback-passed', [refLine]);

        // 未探索(downstreamDistance 未設定)なら距離を付与して下流を開き、自身の本体もスキャン対象に加える
        if (calleeNode.internal && calleeNode.downstreamDistance == null) {
          calleeNode.downstreamDistance = node.downstreamDistance + 1;
          continueDownstream(ts, proj, graph, [{ node: calleeNode, item, depth: calleeNode.downstreamDistance }]);
          for (const n of ctx.nodes.values()) enqueue(n);
        }
      }
    }
  }

  return syncGraph(graph);
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: `test/downstream-callbacks.test.mjs` の6件を含め全件 PASS

- [ ] **Step 7: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/downstream-callbacks.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/lib/graph-builder.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/downstream-callbacks.test.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/fixtures/downstream-callback
git commit -m "feat(cc-func-understand): 下流方向の名前渡しコールバック発見パスを追加 (#9)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 深さ・maxNodes 予算・テスト除外の制約

**Files:**
- Modify: `lib/downstream-callbacks.mjs`(Task 1 で作成したもの)
- Test: `test/downstream-callbacks.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 1 の `addDownstreamCallbacks` / fixture(`usesExcluded` と `src/excluded.ts` を含む)、`test-file-matcher.mjs` の `createFileExcluder(projectRoot, globs)`
- Produces: 変更なし(同じシグネチャのまま、`ctx.downstreamDepth` / `ctx.maxNodes` / `ctx.isFileExcluded` を尊重する)

- [ ] **Step 1: 失敗するテストを書く**

`test/downstream-callbacks.test.mjs` の import に追加:

```js
import { createFileExcluder } from '../lib/test-file-matcher.mjs';
```

テストを追記:

```js
test('downstreamDepth による打ち切り: 上限に達した包含ノードからは発見しない', () => {
  // 深さ0: target 自身が上限に達しているため、本体からの発見を行わない
  // (深さ1のケースは continueDownstream 側の制限だけでも normalize が出ないため、
  //  発見側ガードの失敗テストとしては深さ0の境界を使う)
  const g0 = analyze('target', { downstreamDepth: 0 }, { withUpstreamPass: false });
  assert.ok(!byName(g0, 'helper'), '深さ0では target 本体からの発見も行わない');
  const g1 = analyze('target', { downstreamDepth: 1 }, { withUpstreamPass: false });
  assert.ok(byName(g1, 'helper'), '深さ1では target 直下の発見は行われる');
  assert.ok(!byName(g1, 'normalize'), '発見された helper から先の探索は打ち切られる');
});

test('maxNodes 到達時はノード化せず truncation.frontier に積む', () => {
  // buildGraph 段階で target / fmt / register の3ノードで予算を使い切る
  const g = analyze('target', { maxNodes: 3 }, { withUpstreamPass: false });
  assert.ok(!byName(g, 'helper'));
  assert.equal(g.truncation.reason, 'max-nodes');
  assert.ok(g.truncation.frontier.includes('helper'));
});

test('テスト除外ファイル内の宣言に解決される名前渡しは発見されない', () => {
  const isFileExcluded = createFileExcluder(projectRoot, ['**/excluded.ts']);
  const g = analyze('usesExcluded', { isFileExcluded });
  assert.ok(!byName(g, 'exHelper'));
});

test('除外なしなら excluded.ts の exHelper も発見される(対照)', () => {
  const g = analyze('usesExcluded');
  assert.ok(byName(g, 'exHelper'));
  assert.equal(byName(g, 'exHelper').downstreamDistance, 1);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: 追加4件のうち「対照」以外の3件が FAIL(深さ0でも helper が出る / maxNodes 超過でも helper が出る / 除外ファイルの exHelper が出る)、他は PASS

- [ ] **Step 3: 3つのガードを実装する**

`lib/downstream-callbacks.mjs` の while ループ内、`const node = queue.shift();` の直後に深さガードを追加:

```js
    // 深さ打ち切り: 包含ノードが downstreamDepth に達していたら、その本体からの新規発見はしない
    // (direct-call の下流打ち切りと同じ規則)
    if (node.downstreamDistance >= ctx.downstreamDepth) continue;
```

`if (!decl) continue;` の直後にテスト除外ガードを追加:

```js
        if (ctx.isFileExcluded(decl.file)) continue; // テスト関連ファイル内の宣言はノード化しない
```

`const item = ctx.prepare(...)` の直前(direct-call 二重計上ガードの後)に maxNodes ガードを追加:

```js
        // maxNodes 予算: 新規ノードを作れない場合は frontier に積んで打ち切りを知らせる
        // (stepDirection / addCallbackEdges と同じパターン)
        if (!ctx.nodes.has(calleeId) && ctx.nodes.size >= ctx.maxNodes) {
          ctx.truncation ??= { reason: 'max-nodes', frontier: [] };
          ctx.truncation.frontier.push(decl.name);
          continue;
        }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: 全件 PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/downstream-callbacks.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/downstream-callbacks.test.mjs
git commit -m "feat(cc-func-understand): 下流コールバック発見に深さ・予算・テスト除外の制約を適用 (#9)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: CLI パイプライン統合

**Files:**
- Modify: `analyze-callgraph.mjs:137-138`(パイプラインを3段にする)
- Test: `test/cli.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 1 の `addDownstreamCallbacks(ts, proj, graph, { projectRoot })`
- Produces: CLI 出力 JSON に下流コールバックのノード/エッジが含まれる(外部仕様の変化はこれのみ。スキーマ変更なし)

- [ ] **Step 1: 失敗する CLI テストを書く**

`test/cli.test.mjs` に追記:

```js
test('downstream-callback fixture: 名前渡しされた関数が下流ノード化される(統合)', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/downstream-callback'), '--function', 'target', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const helper = g.nodes.find((n) => n.name === 'helper');
  assert.ok(helper, 'items.map(helper) の helper がノード化される');
  assert.equal(helper.downstreamDistance, 1);
  assert.ok(g.edges.some((e) => e.kind === 'callback-passed' && e.to === helper.id));
  assert.ok(g.nodes.every((n) => !('_selection' in n)), '新ノードも _selection が strip される');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: 追加した CLI テストのみ FAIL(helper が存在しない)

- [ ] **Step 3: パイプラインを3段にする**

`analyze-callgraph.mjs` の import(11行目付近)に追加:

```js
import { addDownstreamCallbacks } from './lib/downstream-callbacks.mjs';
```

137〜138行目を変更:

```js
  let graph = buildGraph(ts, proj, resolution.declaration, buildOpts);
  graph = addDownstreamCallbacks(ts, proj, graph, { projectRoot });
  graph = addCallbackEdges(ts, proj, graph, { projectRoot });
```

- [ ] **Step 4: unit + smoke が通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test && npm run test:smoke`
Expected: unit 全件 PASS、Playwright smoke 4件 PASS(ビューアは `callback-passed` の破線表示に対応済みのため変更不要)

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/analyze-callgraph.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/cli.test.mjs
git commit -m "feat(cc-func-understand): CLI パイプラインに下流コールバック発見パスを組み込み (#9)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ドキュメント更新と v0.6.0

**Files:**
- Modify: `plugins/cc-func-understand/.claude-plugin/plugin.json`(version)
- Modify: `plugins/cc-func-understand/README.md:59`(既知の制約)
- Modify: `plugins/cc-func-understand/skills/func-understand/SKILL.md:110`(注意 > 既知の制約)

**Interfaces:**
- Consumes: なし(ドキュメントのみ)
- Produces: なし

- [ ] **Step 1: plugin.json のバージョンを更新する**

`"version": "0.5.1"` → `"version": "0.6.0"`

- [ ] **Step 2: README の既知の制約を更新する**

README.md 59行目の「動的な呼び出し」項を次に置き換える:

```markdown
- **動的な呼び出し**: イベントリスナー登録・DI コンテナ経由の解決など、実行時にしか決まらない呼び出しは検出できない。関数名をコールバックとして渡した参照(`items.map(helper)` や `register(handler)` など、呼び出しの引数位置への名前渡し)は `callback-passed` エッジとして上下流とも検出される。オブジェクトリテラル経由(`{ onClick: helper }`)や変数代入経由の間接的な受け渡しは、渡された関数が既にグラフに載っている場合のみ検出される。
```

- [ ] **Step 3: SKILL.md の既知の制約を更新する**

SKILL.md 110行目の項を次に置き換える:

```markdown
  - イベント経由・DI経由などの動的な呼び出しは検出できない。関数名の名前渡し(`items.map(helper)` 等、呼び出しの引数位置)は上下流とも `callback-passed` エッジとして検出される。オブジェクトリテラルや変数代入を経由する間接的な受け渡しは、渡された関数が既にグラフに載っている場合のみ検出される。
```

- [ ] **Step 4: 全テストが green のままであることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test && npm run test:smoke`
Expected: 全件 PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/.claude-plugin/plugin.json \
        plugins/cc-func-understand/README.md \
        plugins/cc-func-understand/skills/func-understand/SKILL.md
git commit -m "docs(cc-func-understand): 下流コールバック検出のドキュメント反映と v0.6.0 (#9)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
