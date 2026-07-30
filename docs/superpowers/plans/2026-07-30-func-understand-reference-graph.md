# 参照グラフモード(変数起点)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/func-understand API_CONFIG` のようにモジュールレベルの変数・enum を指定したとき、「その変数を読む関数とその上流」を可視化する参照グラフを自動生成する(スペック: `docs/superpowers/specs/2026-07-30-func-understand-reference-graph-design.md`)。

**Architecture:** `lib/reference-graph.mjs` を新設し、変数ノード(kind `variable`/`enum`)を起点に findReferences で `reads` エッジ(新 kind)を張り、発見した関数から既存の `continueUpstream` / `addCallbackEdges` で上流 BFS を継続する。resolveTarget は新ステータス `resolved-variable` を返し、CLI はそのとき参照グラフを exit 0 で出力する(`meta.mode: "reference"`)。

**Tech Stack:** Node.js(ESM, ランタイム依存ゼロ維持)、TypeScript LanguageService(findReferences / CallHierarchy)、node:test、Playwright(smoke)。

## Global Constraints

- 作業ディレクトリ: `plugins/cc-func-understand/skills/func-understand/scripts/`(以下、相対パスはここ基準。`templates/` と `SKILL.md` は `scripts/` の 1 つ上)
- テスト実行: unit は `node --test test/*.test.mjs`、smoke は `npx playwright test test/smoke.spec.mjs`(**必ず scripts/ ディレクトリから実行**)
- 既存の関数グラフ(buildGraph パイプライン)の出力・挙動は完全不変。既存テストは「仕様変更で明示的に更新するもの」以外すべて green を維持
- reads/writes は区別しない。下流方向の探索はしない。関数内ローカル変数・class・interface・type は参照グラフの起点にしない
- コミットメッセージは既存流儀(`feat(cc-func-understand): ... (#22)` 等 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 1: reference-graph モジュール本体+起点解決ヘルパー

**Files:**
- Create: `lib/reference-graph.mjs`
- Modify: `lib/target-resolver.mjs`(`collectModuleValueDeclarations` を追加。`resolveTarget` は触らない)
- Modify: `lib/graph-builder.mjs`(`createGraphContext` / `truncateCode` に `export` を付けるのみ)
- Modify: `lib/callback-edges.mjs`(`findNodeAt` / `isInImportOrExport` / `moduleItem` に `export` を付けるのみ)
- Create: `test/fixtures/reference-graph/`(tsconfig.json + src/ 5 ファイル)
- Create: `test/reference-graph.test.mjs`

**Interfaces:**
- Consumes: `createGraphContext(ts, proj, opts)` / `syncGraph(graph)` / `continueUpstream(ts, proj, graph, entries)`(graph-builder)、`findNodeAt(ts, sf, pos)` / `isInImportOrExport(ts, node)` / `moduleItem(sf)`(callback-edges)、`collectDeclarations(ts, proj)`(target-resolver)
- Produces:
  - `collectModuleValueDeclarations(ts, proj, name)` → `Array<{ file, relFile: null, name, kind: 'variable'|'enum', selectionStart, startLine, endLine, signature }>`(Task 2 の resolveTarget が使う)
  - `buildReferenceGraph(ts, proj, targetDecl, opts)` → 既存 buildGraph と同形の graph(`{ target, truncation, nodes, edges }` + 非列挙 `_ctx`)。`targetDecl` は上記の宣言オブジェクト(relFile 埋め済み)。opts は `{ projectRoot, maxNodes?, upstreamDepth?, isFileExcluded? }`(Task 2 の CLI が使う)

- [ ] **Step 1: fixture を作成**

`test/fixtures/reference-graph/tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" }, "include": ["src"] }
```

`test/fixtures/reference-graph/src/config.ts`:

```ts
export const SETTINGS = { retries: 3 };

export enum Mode {
  Fast,
  Safe,
}
```

`test/fixtures/reference-graph/src/reader.ts`:

```ts
import { SETTINGS, Mode } from "./config.js";

export function readSettings(): number {
  return SETTINGS.retries;              // 関数内からの読み取り(reads)
}

export function pickMode(): Mode {
  return Mode.Fast;                     // enum の読み取り(reads)
}

export function localShadow(): number {
  const SETTINGS = { retries: 9 };      // 同名ローカル(別シンボルなので拾われない)
  return SETTINGS.retries;
}
```

`test/fixtures/reference-graph/src/caller.ts`:

```ts
import { readSettings } from "./reader.js";

export function handler(): number {
  return readSettings();                // reads した関数の上流(direct-call)
}

export function passes(): Array<() => number> {
  return [readSettings];                // 名前渡し(上流パス addCallbackEdges の確認用)
}
```

`test/fixtures/reference-graph/src/toplevel.ts`:

```ts
import { SETTINGS } from "./config.js";

export const RETRY_COUNT = SETTINGS.retries; // モジュールトップレベルの参照(module ノード化)
```

`test/fixtures/reference-graph/src/excluded-reader.ts`:

```ts
import { SETTINGS } from "./config.js";

export function exReader(): number {
  return SETTINGS.retries;              // テスト除外時に拾われないこと
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/reference-graph.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { collectModuleValueDeclarations } from '../lib/target-resolver.mjs';
import { buildReferenceGraph } from '../lib/reference-graph.mjs';
import { addCallbackEdges } from '../lib/callback-edges.mjs';
import { createFileExcluder } from '../lib/test-file-matcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, 'fixtures/reference-graph');
const { ts } = loadTypeScript(path.join(here, '..'));

function analyze(name, buildOpts = {}, { withUpstreamPass = false } = {}) {
  const proj = loadProject(ts, projectRoot);
  const decls = collectModuleValueDeclarations(ts, proj, name).map((d) => ({
    ...d,
    relFile: path.relative(projectRoot, d.file),
  }));
  assert.equal(decls.length, 1, `${name} はモジュールレベルの値宣言として一意に見つかるはず`);
  let g = buildReferenceGraph(ts, proj, decls[0], { projectRoot, ...buildOpts });
  if (withUpstreamPass) g = addCallbackEdges(ts, proj, g, { projectRoot });
  return g;
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);
const edgesBetween = (g, from, to) => g.edges.filter((e) => e.from === from.id && e.to === to.id);

test('起点の変数ノード: kind variable / upstreamDistance 0 / 宣言文の code を持つ', () => {
  const g = analyze('SETTINGS');
  const target = g.nodes.find((n) => n.id === g.target);
  assert.equal(target.name, 'SETTINGS');
  assert.equal(target.kind, 'variable');
  assert.equal(target.internal, true);
  assert.equal(target.upstreamDistance, 0);
  assert.equal(target.downstreamDistance, null);
  assert.ok(target.code.includes('SETTINGS'));
  assert.equal(target.file, 'src/config.ts');
});

test('変数を読む関数へ reads エッジが張られ upstreamDistance 1 になる', () => {
  const g = analyze('SETTINGS');
  const reader = byName(g, 'readSettings');
  assert.ok(reader, 'SETTINGS を読む readSettings がノード化される');
  assert.equal(reader.upstreamDistance, 1);
  const reads = edgesBetween(g, reader, byName(g, 'SETTINGS')).filter((e) => e.kind === 'reads');
  assert.equal(reads.length, 1);
  assert.ok(reads[0].callLines.length >= 1);
});

test('reads で発見した関数から上流 BFS が継続する(handler が direct-call で乗る)', () => {
  const g = analyze('SETTINGS');
  const handler = byName(g, 'handler');
  assert.ok(handler, 'readSettings の呼び出し元 handler に到達する');
  assert.equal(handler.upstreamDistance, 2);
  const e = edgesBetween(g, handler, byName(g, 'readSettings'));
  assert.equal(e[0].kind, 'direct-call');
});

test('import 文中の参照は reads エッジにならない', () => {
  const g = analyze('SETTINGS');
  // reader.ts / toplevel.ts / excluded-reader.ts の import 行は 1 行目。
  // どの reads エッジの callLines にも 1 行目が含まれないこと。
  for (const e of g.edges.filter((x) => x.kind === 'reads')) {
    assert.ok(!e.callLines.includes(1), `import 行が reads として計上されている: ${JSON.stringify(e)}`);
  }
});

test('同名ローカル変数(localShadow 内)は別シンボルなので拾われない', () => {
  const g = analyze('SETTINGS');
  const shadow = byName(g, 'localShadow');
  assert.equal(shadow, undefined, 'localShadow は SETTINGS を参照していないためグラフに乗らない');
});

test('モジュールトップレベルの参照は module ノードから reads エッジになる', () => {
  const g = analyze('SETTINGS');
  const mod = g.nodes.find((n) => n.kind === 'module' && n.name === 'src/toplevel.ts');
  assert.ok(mod, 'toplevel.ts が module ノード化される');
  const reads = edgesBetween(g, mod, byName(g, 'SETTINGS')).filter((e) => e.kind === 'reads');
  assert.equal(reads.length, 1);
});

test('enum も起点にでき、読み取り関数へ reads エッジが張られる', () => {
  const g = analyze('Mode');
  const target = g.nodes.find((n) => n.id === g.target);
  assert.equal(target.kind, 'enum');
  const picker = byName(g, 'pickMode');
  assert.ok(picker, 'Mode を読む pickMode がノード化される');
  assert.ok(edgesBetween(g, picker, target).some((e) => e.kind === 'reads'));
});

test('テスト除外ファイル内の参照はノード化されない', () => {
  const isFileExcluded = createFileExcluder(projectRoot, ['**/excluded-reader.ts']);
  const g = analyze('SETTINGS', { isFileExcluded });
  assert.equal(byName(g, 'exReader'), undefined);
});

test('除外なしなら exReader も乗る(対照)', () => {
  const g = analyze('SETTINGS');
  assert.ok(byName(g, 'exReader'));
});

test('maxNodes 到達時はノード化せず truncation.frontier に積む', () => {
  const g = analyze('SETTINGS', { maxNodes: 1 });
  assert.equal(g.nodes.length, 1, '起点のみ');
  assert.equal(g.truncation.reason, 'max-nodes');
  assert.ok(g.truncation.frontier.includes('readSettings'));
});

test('upstreamDepth 0 では読み取り関数を発見しない(起点のみ)', () => {
  const g = analyze('SETTINGS', { upstreamDepth: 0 });
  assert.equal(g.nodes.length, 1);
});

test('後段 addCallbackEdges で名前渡しの上流(passes)も検出される', () => {
  const g = analyze('SETTINGS', {}, { withUpstreamPass: true });
  const passes = byName(g, 'passes');
  assert.ok(passes, '[readSettings] の名前渡しをする passes が上流ノード化される');
  const cb = edgesBetween(g, passes, byName(g, 'readSettings')).filter((e) => e.kind === 'callback-passed');
  assert.equal(cb.length, 1);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `node --test test/reference-graph.test.mjs`
Expected: FAIL(`collectModuleValueDeclarations` / `buildReferenceGraph` が存在しない import エラー)

- [ ] **Step 4: `collectModuleValueDeclarations` を実装**

`lib/target-resolver.mjs` の `collectNonFunctionDeclarations` の直後に追加(`resolveTarget` は変更しない):

```js
/**
 * モジュールスコープの値宣言(変数・enum)から指定名に一致するものを収集する。
 * 参照グラフモード(resolved-variable)の起点解決に使う。
 * - 変数は SourceFile 直下の VariableStatement のみ(関数内ローカル・catch 節・
 *   for-of ループ変数は対象外 → 指定時は not-found に落ちる)
 * - アロー関数/関数式を初期化子に持つ変数は関数宣言(collectDeclarations 側)の
 *   担当なので対象外
 * relFile はここでは計算しない(呼び出し側で projectRoot を使って解決する)。
 */
export function collectModuleValueDeclarations(ts, proj, name) {
  const matches = [];
  const entry = (sf, rangeNode, nameNode, kind) => {
    const start = sf.getLineAndCharacterOfPosition(rangeNode.getStart(sf));
    const end = sf.getLineAndCharacterOfPosition(rangeNode.getEnd());
    return {
      file: sf.fileName,
      relFile: null,
      name: nameNode.text,
      kind,
      selectionStart: nameNode.getStart(sf),
      startLine: start.line + 1,
      endLine: end.line + 1,
      signature: sf.text.slice(rangeNode.getStart(sf), rangeNode.getEnd()).split('\n')[0].slice(0, 120),
    };
  };
  for (const sf of proj.program.getSourceFiles()) {
    if (!proj.isInternal(sf.fileName)) continue;
    for (const stmt of sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) continue;
          matches.push(entry(sf, stmt, decl.name, 'variable'));
        }
      } else if (ts.isEnumDeclaration(stmt) && stmt.name.text === name) {
        matches.push(entry(sf, stmt, stmt.name, 'enum'));
      }
    }
  }
  return matches;
}
```

- [ ] **Step 5: 共有ヘルパーを export する**

- `lib/graph-builder.mjs`: `function truncateCode(` → `export function truncateCode(`、`function createGraphContext(` → `export function createGraphContext(`
- `lib/callback-edges.mjs`: `function findNodeAt(` → `export function findNodeAt(`、`function isInImportOrExport(` → `export function isInImportOrExport(`、`function moduleItem(` → `export function moduleItem(`

- [ ] **Step 6: `lib/reference-graph.mjs` を実装**

```js
import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';
import { createGraphContext, syncGraph, continueUpstream, truncateCode } from './graph-builder.mjs';
import { findNodeAt, isInImportOrExport, moduleItem } from './callback-edges.mjs';

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * 参照グラフモード(スペック: docs/superpowers/specs/2026-07-30-func-understand-reference-graph-design.md)。
 * モジュールレベルの変数/enum を起点に、findReferences で「読んでいる関数」へ
 * reads エッジを張り、そこから既存の上流 BFS(continueUpstream)を継続する。
 * 下流方向は探索しない(変数は呼び出さないため片方向グラフ)。
 * targetDecl は collectModuleValueDeclarations の戻り値(relFile 埋め済み)。
 */
export function buildReferenceGraph(ts, proj, targetDecl, opts) {
  const { projectRoot } = opts;
  const ctx = createGraphContext(ts, proj, opts);

  // 起点(変数/enum)ノード。CallHierarchyItem を経由できないため手動で構築する。
  // id 形式・フィールドは既存の内部ノード規約(itemToNode)に合わせる。
  const sf = proj.program.getSourceFile(targetDecl.file);
  const relFile = path.relative(projectRoot, targetDecl.file);
  const targetId = `${relFile}#${targetDecl.selectionStart}`;
  const lineStarts = sf.getLineStarts();
  const startPos = lineStarts[targetDecl.startLine - 1];
  const endPos = targetDecl.endLine < lineStarts.length ? lineStarts[targetDecl.endLine] : sf.text.length;
  const { code, codeTruncated } = truncateCode(sf.text.slice(startPos, endPos));
  const targetNode = {
    id: targetId,
    name: targetDecl.name,
    kind: targetDecl.kind, // 'variable' | 'enum'
    internal: true,
    file: relFile,
    startLine: targetDecl.startLine,
    endLine: targetDecl.endLine,
    code,
    codeTruncated,
    upstreamDistance: 0,
    downstreamDistance: null,
    summary: null,
    _selection: { file: targetDecl.file, start: targetDecl.selectionStart },
  };
  ctx.nodes.set(targetId, targetNode);

  const graph = { target: targetId, truncation: null, nodes: [], edges: [] };
  Object.defineProperty(graph, '_ctx', { value: ctx, enumerable: false, writable: true, configurable: true });

  // upstreamDepth 0 は「起点のみ」(関数グラフの深さ規約と同じ)
  if (ctx.upstreamDepth < 1) return syncGraph(graph);

  // 参照位置を含む最内の関数様宣言の逆引き(callback-edges の findEnclosingDecl と同じ行ベース判定)
  const decls = collectDeclarations(ts, proj).map((d) => ({ ...d, relFile: path.relative(projectRoot, d.file) }));
  const findEnclosingDecl = (refSf, refPos) => {
    const line = lineOf(refSf, refPos);
    const rel = path.relative(projectRoot, refSf.fileName);
    const candidates = decls.filter((d) => d.relFile === rel && d.startLine <= line && line <= d.endLine);
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
    return candidates[0];
  };

  const upstreamEntries = [];
  const referenced = proj.service.findReferences(targetDecl.file, targetDecl.selectionStart) ?? [];
  for (const group of referenced) {
    for (const ref of group.references) {
      if (ref.isDefinition) continue;
      const refSf = proj.program.getSourceFile(ref.fileName);
      if (!refSf) continue;
      if (ctx.isFileExcluded(ref.fileName)) continue;
      const refNode = findNodeAt(ts, refSf, ref.textSpan.start);
      if (!refNode) continue;
      if (isInImportOrExport(ts, refNode)) continue;

      const refLine = lineOf(refSf, ref.textSpan.start);
      const enclosing = findEnclosingDecl(refSf, ref.textSpan.start);
      const enclosingId = enclosing
        ? `${enclosing.relFile}#${enclosing.selectionStart}`
        : `${path.relative(projectRoot, refSf.fileName)}#0`;

      const alreadyExists = ctx.nodes.has(enclosingId);
      if (!alreadyExists && ctx.nodes.size >= ctx.maxNodes) {
        ctx.truncation ??= { reason: 'max-nodes', frontier: [] };
        const frontierName = enclosing ? enclosing.name : path.relative(projectRoot, refSf.fileName);
        if (!ctx.truncation.frontier.includes(frontierName)) ctx.truncation.frontier.push(frontierName);
        continue;
      }

      let fromNode;
      let fromItem;
      if (alreadyExists) {
        fromNode = ctx.nodes.get(enclosingId);
      } else if (enclosing) {
        fromItem = ctx.prepare(enclosing.file, enclosing.selectionStart);
        if (!fromItem) continue;
        fromNode = ctx.itemToNode(fromItem);
      } else {
        fromItem = moduleItem(refSf);
        fromNode = ctx.itemToNode(fromItem, ref.textSpan);
      }

      if (fromNode.upstreamDistance == null) fromNode.upstreamDistance = 1;
      ctx.upsertEdge(fromNode.id, targetId, 'reads', [refLine]);

      if (!alreadyExists && fromItem && fromNode.internal) {
        upstreamEntries.push({ node: fromNode, item: fromItem, depth: 1 });
      }
    }
  }

  continueUpstream(ts, proj, graph, upstreamEntries);
  return syncGraph(graph);
}
```

- [ ] **Step 7: テストを実行して pass を確認**

Run: `node --test test/reference-graph.test.mjs`
Expected: 全 12 件 PASS

- [ ] **Step 8: 既存 unit テストが green のままか確認**

Run: `node --test test/*.test.mjs`
Expected: 全件 PASS(export 追加は挙動を変えない)

- [ ] **Step 9: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/ plugins/cc-func-understand/skills/func-understand/scripts/test/
git commit -m "feat(cc-func-understand): 参照グラフモードのコア実装(reads エッジ+上流継続) (#22)"
```

---

### Task 2: resolveTarget の resolved-variable 化+ローカル変数ノイズ整理+CLI 配線

**Files:**
- Modify: `lib/target-resolver.mjs`(`resolveTarget` と `collectNonFunctionDeclarations`)
- Modify: `analyze-callgraph.mjs`
- Modify: `test/target-resolver.test.mjs`(既存テストの仕様変更反映+追加)
- Modify: `test/cli.test.mjs`(not-a-function E2E の更新+参照グラフ E2E 追加)
- Modify: `test/fixtures/not-a-function/src/config.ts`(interface Config を末尾に追加)
- Create: `test/fixtures/not-a-function/src/locals.ts`

**Interfaces:**
- Consumes: `collectModuleValueDeclarations(ts, proj, name)`、`buildReferenceGraph(ts, proj, targetDecl, opts)`(Task 1)
- Produces:
  - `resolveTarget` の新ステータス `{ status: 'resolved-variable', declaration }`(declaration は relFile 埋め済みの値宣言)。同名複数は既存と同じ `{ status: 'ambiguous', candidates }`
  - CLI stdout(参照グラフ時): `{ status: 'ok', mode: 'reference', nodes, edges, truncated, out }`、graph.json の `meta.mode: 'reference'`(Task 3 のビューアが使う)

- [ ] **Step 1: fixture を更新**

`test/fixtures/not-a-function/src/config.ts` の末尾に追加(既存行は変更しない):

```ts
export interface Config {
  retries: number;
}
```

`test/fixtures/not-a-function/src/locals.ts` を新規作成:

```ts
export function withLocals(items: string[]): string {
  const LOCAL_CFG = { retries: 1 };     // 関数内ローカル(起点にも not-a-function にもならない)
  try {
    return items.join(",") + LOCAL_CFG.retries;
  } catch (caughtErr) {                 // catch 節の変数(同上)
    return String(caughtErr);
  }
}

export function loops(items: string[]): number {
  let total = 0;
  for (const loopItem of items) {       // for-of ループ変数(同上)
    total += loopItem.length;
  }
  return total;
}
```

- [ ] **Step 2: target-resolver のテストを仕様変更に合わせて更新+追加**

`test/target-resolver.test.mjs` の既存テストを以下のとおり書き換える:

「オブジェクト定数を指定すると not-a-function になり kind と場所を返す」を置換:

```js
test('モジュールレベルのオブジェクト定数は resolved-variable になり宣言情報を返す', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'API_CONFIG' }, root);
  assert.equal(r.status, 'resolved-variable');
  assert.equal(r.declaration.kind, 'variable');
  assert.equal(r.declaration.relFile, 'src/config.ts');
  assert.ok(r.declaration.selectionStart > 0);
  assert.ok(r.declaration.startLine >= 1);
});
```

「プリミティブ定数・初期化子なし変数も not-a-function(kind: variable)になる」を置換:

```js
test('プリミティブ定数・初期化子なし変数も resolved-variable になる', () => {
  const { root, proj: p } = proj('not-a-function');
  assert.equal(resolveTarget(ts, p, { functionName: 'MAX_RETRIES' }, root).status, 'resolved-variable');
  const r = resolveTarget(ts, p, { functionName: 'counter' }, root);
  assert.equal(r.status, 'resolved-variable');
  assert.equal(r.declaration.kind, 'variable');
});
```

「クラス・enum・interface・type も not-a-function になり kind を区別する」を置換(enum は resolved-variable 側へ移動):

```js
test('クラス・interface・type は従来どおり not-a-function で kind を区別する', () => {
  const { root, proj: p } = proj('not-a-function');
  const kinds = ['WidgetStore', 'Widget', 'WidgetId'].map(
    (n) => resolveTarget(ts, p, { functionName: n }, root)
  );
  assert.ok(kinds.every((r) => r.status === 'not-a-function'));
  assert.deepEqual(kinds.map((r) => r.matches[0].kind), ['class', 'interface', 'type']);
});

test('モジュールレベルの enum は resolved-variable(kind: enum)になる', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'Color' }, root);
  assert.equal(r.status, 'resolved-variable');
  assert.equal(r.declaration.kind, 'enum');
});
```

「not-a-function でも部分一致の関数候補を suggestions に返す」を置換(config 変数は resolved-variable になるため interface Config を使う):

```js
test('not-a-function でも部分一致の関数候補を suggestions に返す', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'Config' }, root);
  assert.equal(r.status, 'not-a-function');
  assert.equal(r.matches[0].kind, 'interface');
  assert.ok(r.suggestions.some((s) => s.name === 'loadConfig'));
});
```

「not-a-function でも --file/--line で絞り込みが効く…」を置換:

```js
test('resolved-variable でも --file 絞り込みが効く(指定ファイル外は not-found)', () => {
  const { root, proj: p } = proj('not-a-function');
  const r1 = resolveTarget(ts, p, { functionName: 'API_CONFIG', file: 'src/other.ts' }, root);
  assert.equal(r1.status, 'not-found');
  const r2 = resolveTarget(ts, p, { functionName: 'API_CONFIG', file: 'src/config.ts' }, root);
  assert.equal(r2.status, 'resolved-variable');
});
```

「not-a-function の --line 絞り込み…(SITE_LIMIT)」を置換:

```js
test('同名のモジュール変数が複数あれば ambiguous、--line で一意に絞れる', () => {
  const { root, proj: p } = proj('not-a-function');
  const all = resolveTarget(ts, p, { functionName: 'SITE_LIMIT' }, root);
  assert.equal(all.status, 'ambiguous');
  assert.equal(all.candidates.length, 2);
  const siteB = all.candidates.find((m) => m.relFile === 'src/site-b.ts');
  const r = resolveTarget(ts, p, { functionName: 'SITE_LIMIT', line: siteB.startLine }, root);
  assert.equal(r.status, 'resolved-variable');
  assert.equal(r.declaration.relFile, 'src/site-b.ts');
  assert.equal(resolveTarget(ts, p, { functionName: 'SITE_LIMIT', line: 999 }, root).status, 'not-found');
});
```

末尾に追加:

```js
test('関数内ローカル・catch 節・for-of 変数は not-found(ノイズにならない)', () => {
  const { root, proj: p } = proj('not-a-function');
  for (const name of ['LOCAL_CFG', 'caughtErr', 'loopItem']) {
    assert.equal(resolveTarget(ts, p, { functionName: name }, root).status, 'not-found', name);
  }
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `node --test test/target-resolver.test.mjs`
Expected: 更新した各テストが FAIL(resolved-variable が未実装なので not-a-function が返る等)

- [ ] **Step 4: resolveTarget を実装**

`lib/target-resolver.mjs` の `resolveTarget` 内、`if (matched.length > 1) ...` の直後(suggestions 計算の前)に挿入:

```js
  // 関数として見つからない場合、モジュールスコープの値宣言(変数・enum)なら
  // 参照グラフモードの起点として解決する(resolved-variable)。--file/--line の
  // 絞り込みは関数と同じルールを適用する。
  let valueDecls = collectModuleValueDeclarations(ts, proj, name).map((d) => ({
    ...d,
    relFile: path.relative(projectRoot, d.file),
  }));
  if (file) valueDecls = valueDecls.filter((d) => d.relFile === file || d.relFile.endsWith(file));
  if (line != null) valueDecls = valueDecls.filter((d) => d.startLine <= line && line <= d.endLine);
  if (valueDecls.length === 1) return { status: 'resolved-variable', declaration: valueDecls[0] };
  if (valueDecls.length > 1) return { status: 'ambiguous', candidates: valueDecls };
```

同ファイルの `collectNonFunctionDeclarations` から**変数の分岐を削除**する(モジュールスコープ変数は上の resolved-variable が先に拾い、関数内ローカルは意図的に not-found へ落とすため、この分岐は到達不能になる)。JSDoc も「対象は クラス・enum・interface・type エイリアス(変数は resolved-variable 側で処理)」に更新。削除するのは以下のブロック:

```js
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        !(node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
      ) {
        nameNode = node.name;
        kind = 'variable';
        rangeNode =
          node.parent?.parent && ts.isVariableStatement(node.parent.parent)
            ? node.parent.parent
            : node;
      } else if (ts.isClassDeclaration(node) && node.name) {
```

→ `if (ts.isClassDeclaration(node) && node.name) {` から始まる形にする。

- [ ] **Step 5: テストを実行して pass を確認**

Run: `node --test test/target-resolver.test.mjs`
Expected: 全件 PASS

- [ ] **Step 6: cli.test を更新+参照グラフ E2E を追加**

`test/cli.test.mjs` の「非関数の変数名は exit 2 で not-a-function と kind・場所を返す」を置換(変数は exit 0 になるため class で検証):

```js
test('クラス名は exit 2 で not-a-function と kind・場所を返す', () => {
  const outPath = tmp();
  const r = run(['--project', path.join(here, 'fixtures/not-a-function'), '--function', 'WidgetStore', '--out', outPath]);
  assert.equal(r.code, 2);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'not-a-function');
  assert.equal(status.matches[0].kind, 'class');
  assert.ok(status.matches[0].relFile && status.matches[0].startLine);
  assert.ok(Array.isArray(status.suggestions));
  assert.ok(!fs.existsSync(outPath));
});
```

末尾に追加:

```js
test('変数指定は参照グラフモードとして exit 0 / mode: reference のグラフを生成する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/reference-graph'), '--function', 'SETTINGS', '--out', out]);
  assert.equal(r.code, 0);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'ok');
  assert.equal(status.mode, 'reference');
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(g.meta.mode, 'reference');
  const target = g.nodes.find((n) => n.id === g.target);
  assert.equal(target.kind, 'variable');
  assert.ok(g.edges.some((e) => e.kind === 'reads'));
  assert.ok(g.nodes.every((n) => !('_selection' in n)), '_selection が strip される');
});

test('関数グラフの stdout / meta に mode が付かない(既存出力不変)', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'getUser', '--out', out]);
  assert.equal(r.code, 0);
  assert.ok(!('mode' in JSON.parse(r.stdout)));
  assert.ok(!('mode' in JSON.parse(fs.readFileSync(out, 'utf8')).meta));
});
```

- [ ] **Step 7: テストを実行して失敗を確認**

Run: `node --test test/cli.test.mjs`
Expected: 追加/更新テストが FAIL(CLI が resolved-variable 未対応のため buildGraph に流れて例外、または mode 欠落)

- [ ] **Step 8: CLI を実装**

`analyze-callgraph.mjs`:

1. import に追加: `import { buildReferenceGraph } from './lib/reference-graph.mjs';`
2. パイプライン部(`let graph = buildGraph(...)` から `graph = addCallbackEdges(...)` まで)を分岐に置換:

```js
  const isReferenceMode = resolution.status === 'resolved-variable';
  let graph;
  if (isReferenceMode) {
    // 参照グラフモード: 下流探索なし。--downstream-depth は無視する(エラーにしない)
    graph = buildReferenceGraph(ts, proj, resolution.declaration, buildOpts);
    graph = addCallbackEdges(ts, proj, graph, { projectRoot });
  } else {
    graph = buildGraph(ts, proj, resolution.declaration, buildOpts);
    graph = addDownstreamCallbacks(ts, proj, graph, { projectRoot });
    graph = addCallbackEdges(ts, proj, graph, { projectRoot });
  }
```

3. `graph.meta = { ... }` に条件付きで mode を追加:

```js
  graph.meta = {
    tsVersion,
    tsSource,
    tsconfig: proj.tsconfigPath ? path.relative(projectRoot, proj.tsconfigPath) : null,
    limitations: buildLimitations(ts, proj.tsconfigPath),
    ...(isReferenceMode ? { mode: 'reference' } : {}),
  };
```

4. stdout も同様:

```js
  process.stdout.write(
    `${JSON.stringify({ status: 'ok', ...(isReferenceMode ? { mode: 'reference' } : {}), nodes: graph.nodes.length, edges: graph.edges.length, truncated: Boolean(graph.truncation), out: outPath })}\n`
  );
```

(テスト除外の「起点がテストファイル内なら無効化」判定は `resolution.declaration.file` を使う既存コードのままで resolved-variable にもそのまま効く — 変更不要)

- [ ] **Step 9: テストを実行して pass を確認**

Run: `node --test test/cli.test.mjs && node --test test/*.test.mjs`
Expected: 全件 PASS

- [ ] **Step 10: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/
git commit -m "feat(cc-func-understand): 変数指定を resolved-variable として参照グラフに自動フォールバック (#22)"
```

---

### Task 3: ビューア対応(variable/enum ノード・reads エッジ・モードバナー)+smoke

**Files:**
- Modify: `../templates/viewer.js`(scripts/ から見て。実パス `plugins/cc-func-understand/skills/func-understand/templates/viewer.js`)
- Modify: `../templates/viewer.css`
- Modify: `test/smoke.spec.mjs`

**Interfaces:**
- Consumes: graph.json の `meta.mode === 'reference'`、ノード kind `variable`/`enum`、エッジ kind `reads`(Task 2)
- Produces: なし(表示のみ)

- [ ] **Step 1: 失敗する smoke テストを書く**

`test/smoke.spec.mjs` の末尾に追加(⑬の後):

```js
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
```

- [ ] **Step 2: smoke を実行して⑭の失敗を確認**

Run: `npx playwright test test/smoke.spec.mjs`
Expected: ⑭のみ FAIL(reads クラス未付与・mode-line 不在)、①〜⑬は PASS

- [ ] **Step 3: viewer.js / viewer.css を実装**

`../templates/viewer.js`:

1. `buildElements()` のエッジ classes を置換:

```js
        classes: e.kind === 'callback-passed' ? 'callback' : e.kind === 'reads' ? 'reads' : '',
```

2. `CY_STYLE` の `edge.callback` セレクタの直後に追加:

```js
  {
    selector: 'edge.reads',
    style: {
      'line-style': 'dotted',
      label: 'reads',
      'line-color': '#a371f7',
      'target-arrow-color': '#a371f7',
    },
  },
```

3. `CY_STYLE` の `node.is-target` セレクタの**直後**に追加(is-target より後に置くことで、起点=変数ノードでも枠色の区別が効く):

```js
  {
    selector: 'node[kind="variable"], node[kind="enum"]',
    style: { 'border-color': '#d29922', 'border-width': 2, 'border-style': 'double' },
  },
```

4. `buildBanner()` の `banner.appendChild(metaLine);` の直後に追加:

```js
  if (meta.mode === 'reference') {
    const modeLine = document.createElement('div');
    modeLine.className = 'mode-line';
    modeLine.textContent = '参照グラフモード: 変数起点・上流のみ(この変数を読む関数とその呼び出し元)';
    banner.appendChild(modeLine);
  }
```

`../templates/viewer.css` のバナー節(`.entry-note` の後)に追加:

```css
#banner .mode-line {
  color: #d29922;
  font-size: 12px;
  margin-bottom: 4px;
}
```

- [ ] **Step 4: smoke を実行して pass を確認**

Run: `npx playwright test test/smoke.spec.mjs`
Expected: 全 14 件 PASS

- [ ] **Step 5: unit も green のままか確認してコミット**

Run: `node --test test/*.test.mjs`
Expected: 全件 PASS

```bash
git add plugins/cc-func-understand/skills/func-understand/templates/ plugins/cc-func-understand/skills/func-understand/scripts/test/smoke.spec.mjs
git commit -m "feat(cc-func-understand): ビューアに参照グラフモード表示(reads エッジ・変数ノード・バナー) (#22)"
```

---

### Task 4: SKILL.md / README / バージョン v0.7.0

**Files:**
- Modify: `../SKILL.md`(実パス `plugins/cc-func-understand/skills/func-understand/SKILL.md`)
- Modify: `plugins/cc-func-understand/README.md`
- Modify: `plugins/cc-func-understand/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: Task 2 の CLI 挙動(exit 0 / `mode: "reference"`、not-a-function から variable/enum が消える)
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: SKILL.md を更新**

1. exit 2 ハンドリング一覧の `not-a-function` 項を更新: kind の列挙から `variable`/`enum` を外し `(class/interface/type)` にする。説明文に「モジュールレベルの変数・enum を指定した場合は参照グラフモードとして自動解析されるため、このステータスにはならない」と追記
2. 正常系の説明(グラフの読み方の節)に参照グラフモードの項を追加:
   - stdout / graph.json に `mode: "reference"` が付いたら参照グラフモード(変数起点)
   - グラフは「指定した変数・enum を読む関数(reads エッジ)とその上流呼び出し元」で、下流方向は存在しない
   - 関数内ローカル変数は起点にできない(not-found になる)
   - ambiguous の candidates に kind `variable`/`enum` が混ざり得る(既存の再実行手順はそのまま)

- [ ] **Step 2: README を更新**

1. 機能説明に参照グラフモード(変数・enum 指定時の自動フォールバック、上流のみ)を追記
2. 既知の制約に「関数内ローカル変数・class・interface・type は参照グラフの起点にできない」を追記
3. 変更履歴の先頭に追加:

```markdown
- v0.7.0: 変数・enum 指定時の参照グラフモード(reads エッジ+上流探索)を追加(issue #21)。関数内ローカル変数(catch/for-of 含む)は not-a-function 検出から除外し not-found に。
```

- [ ] **Step 3: plugin.json のバージョンを上げる**

`plugins/cc-func-understand/.claude-plugin/plugin.json` の `"version": "0.6.0"` → `"version": "0.7.0"`

- [ ] **Step 4: 全テストを実行して green を確認**

Run: `node --test test/*.test.mjs && npx playwright test test/smoke.spec.mjs`
Expected: unit 全件 + smoke 14 件 PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/
git commit -m "docs(cc-func-understand): 参照グラフモードのドキュメント反映と v0.7.0 (#22)"
```
