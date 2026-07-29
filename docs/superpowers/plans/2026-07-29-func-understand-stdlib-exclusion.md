# func-understand 標準ライブラリ除外 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/func-understand` のグラフから TS 標準ライブラリ(`Array.prototype.push` 等)と Node 組み込み(`fs.readFileSync` 等)のノードを除外し、リポ内独自定義の関数と npm 依存だけが見えるようにする。

**Architecture:** 分類器 `lib/symbol-classifier.mjs` を新設し(`program.isSourceFileDefaultLibrary()` + `@types/node` パス判定)、`graph-builder.mjs` の `stepDirection` ループ先頭・maxNodes チェック前で stdlib シンボルを弾く。npm パッケージの `external-boundary` ノードは従来どおり残す。スペック: `docs/superpowers/specs/2026-07-29-func-understand-stdlib-exclusion-design.md`。

**Tech Stack:** Node.js (ESM, `.mjs`)、TypeScript Compiler API(LanguageService / Call Hierarchy)、`node --test`、Playwright(smoke)。

## Global Constraints

- 作業ディレクトリ: `plugins/cc-func-understand/skills/func-understand/scripts/`(以下、パスはここからの相対。テスト実行はこのディレクトリで行う)
- テストコマンド: `npm test`(= `node --test "test/*.test.mjs"`)、smoke は `npm run test:smoke`
- コメント・アサーションメッセージは既存コードに合わせて日本語
- `--include-stdlib` のような復元フラグは追加しない(YAGNI)
- ビューア(`templates/`)と `analyze-callgraph.mjs` CLI は変更しない
- 下流方向のコールバック名前渡し(`items.map(helper)`)の検出は本計画のスコープ外
- 依存パッケージの追加・更新はしない

---

### Task 1: ブランチ作成 + symbol-classifier 新設

**Files:**
- Create: `lib/symbol-classifier.mjs`
- Test: `test/symbol-classifier.test.mjs`
- Commit only: `docs/superpowers/specs/2026-07-29-func-understand-stdlib-exclusion-design.md`(リポジトリルート。未コミットのスペックをここで取り込む)

**Interfaces:**
- Consumes: `loadProject()` が返す `proj.program`(TS `Program`)、`loadTypeScript()`(いずれも既存)
- Produces: `classifySymbolFile(program, file: string): 'stdlib' | 'other'` — Task 2b で `stepDirection` から呼ばれる。`program.getSourceFile(file)` が undefined でも安全に動作すること(その場合はパス判定のみ)。

- [ ] **Step 1: ブランチを作成し、スペックをコミットする**

```bash
cd /Users/ryutoharaguchi/develop/cc-plugins
git checkout -b feat/func-understand-stdlib-exclusion
git add docs/superpowers/specs/2026-07-29-func-understand-stdlib-exclusion-design.md
git commit -m "docs(cc-func-understand): 標準ライブラリ除外の設計スペックを追加"
```

- [ ] **Step 2: 失敗するテストを書く**

`test/symbol-classifier.test.mjs` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { classifySymbolFile } from '../lib/symbol-classifier.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

// パス判定のみを検証するためのスタブ(program に解決先が無いケースの安全性も兼ねる)
const stubProgram = { getSourceFile: () => undefined };

test('@types/node のパスは stdlib、他の @types パッケージは誤爆しない', () => {
  assert.equal(classifySymbolFile(stubProgram, '/p/node_modules/@types/node/fs.d.ts'), 'stdlib');
  assert.equal(classifySymbolFile(stubProgram, '/p/node_modules/@types/node/index.d.ts'), 'stdlib');
  assert.equal(classifySymbolFile(stubProgram, '/p/node_modules/@types/node-fetch/index.d.ts'), 'other');
  assert.equal(classifySymbolFile(stubProgram, '/p/src/node/index.ts'), 'other');
  // Windows 形式のパス区切りでも判定できる
  assert.equal(classifySymbolFile(stubProgram, 'C:\\p\\node_modules\\@types\\node\\fs.d.ts'), 'stdlib');
});

test('default library は program の公式 API で stdlib 判定される', () => {
  const projectRoot = path.join(here, 'fixtures', 'basic');
  const proj = loadProject(ts, projectRoot);
  const libPath = ts.getDefaultLibFilePath(proj.program.getCompilerOptions());
  const libSf = proj.program.getSourceFile(libPath);
  assert.ok(libSf, 'default lib が program に含まれている前提を確認');
  assert.equal(classifySymbolFile(proj.program, libSf.fileName), 'stdlib');
  // プロジェクト内ファイルは other
  assert.equal(classifySymbolFile(proj.program, path.join(projectRoot, 'src', 'service.ts')), 'other');
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/symbol-classifier.test.mjs`
Expected: FAIL(`Cannot find module '../lib/symbol-classifier.mjs'`)

- [ ] **Step 4: 最小実装を書く**

`lib/symbol-classifier.mjs` を新規作成:

```js
/**
 * Call Hierarchy が返したシンボルの解決先ファイルを分類する。
 * 'stdlib'(TS 標準ライブラリ / Node 組み込み)はグラフのノードにしない
 * (スペック: docs/superpowers/specs/2026-07-29-func-understand-stdlib-exclusion-design.md)。
 *
 * - TS 標準ライブラリ: program.isSourceFileDefaultLibrary() の公式 API で判定する。
 *   パスのパターンマッチと違い、プロジェクト版/同梱版 TS や lib 置換パッケージでも
 *   TS 自身の認識と常に一致する。
 * - Node 組み込み(fs/path 等): @types/node の d.ts に解決される。
 *   `@types/node-fetch` 等の別パッケージを誤爆しないよう区切り文字込みで判定する。
 * - 解決先が program に無い場合はフォールバックせず 'other'(従来どおり境界ノード表示)。
 */
export function classifySymbolFile(program, file) {
  const sf = program.getSourceFile(file);
  if (sf && program.isSourceFileDefaultLibrary(sf)) return 'stdlib';
  if (file.replace(/\\/g, '/').includes('/node_modules/@types/node/')) return 'stdlib';
  return 'other';
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/symbol-classifier.test.mjs`
Expected: PASS(2 tests)

- [ ] **Step 6: 既存テストが壊れていないことを確認してコミット**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: 全テスト PASS(この時点では挙動変更なし)

```bash
cd /Users/ryutoharaguchi/develop/cc-plugins
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/symbol-classifier.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/symbol-classifier.test.mjs
git commit -m "feat(cc-func-understand): stdlib 分類器 symbol-classifier を追加"
```

---

### Task 2: basic fixture を @types/node 非依存に改修

**背景(実測済み):** `basic` fixture は `node_modules/@types/node/index.d.ts` スタブ経由で `basename` を境界ノードにしており、Task 3 の除外を入れるとこのノードが消えて `graph-builder.test.mjs` の 2 テスト(境界ノード検証・シンボル単位重複排除)が壊れる。先に境界ノードの供給源を疑似 npm パッケージ `fake-lib` に差し替え、**挙動変更前にテストを green のまま**保つ。

**Files:**
- Create: `test/fixtures/basic/node_modules/fake-lib/package.json`
- Create: `test/fixtures/basic/node_modules/fake-lib/index.d.ts`
- Delete: `test/fixtures/basic/node_modules/@types/node/index.d.ts`
- Modify: `test/fixtures/basic/src/service.ts`, `test/fixtures/basic/src/util.ts`
- Modify: `test/graph-builder.test.mjs`(`basename` → `shorten` の 2 テスト)

**Interfaces:**
- Produces: `basic` fixture の外部境界シンボルは `fake-lib` の `shorten(p: string, ext?: string): string` になる(`getUser` と `formatName` の両方が呼ぶ = 重複排除テストの前提を維持)。Task 3 以降、`basic` に stdlib 解決されるシンボルは存在しない。

- [ ] **Step 1: fixture を差し替える**

`test/fixtures/basic/node_modules/fake-lib/package.json` を新規作成:

```json
{ "name": "fake-lib", "version": "1.0.0", "types": "index.d.ts" }
```

`test/fixtures/basic/node_modules/fake-lib/index.d.ts` を新規作成:

```ts
export declare function shorten(p: string, ext?: string): string;
```

`test/fixtures/basic/src/service.ts` を全置換:

```ts
import { formatName } from "./util.js";
import { shorten } from "fake-lib";

export function getUser(id: string): string {
  return formatName(id) + shorten("/tmp/x");
}
```

`test/fixtures/basic/src/util.ts` を全置換:

```ts
import { shorten } from "fake-lib";

export function formatName(id: string): string {
  return `user-${id}-${shorten("/tmp/y")}`;
}
```

`test/fixtures/basic/node_modules/@types/node/` ディレクトリを削除する(スタブは Task 3 の stdlib fixture が同内容を持つ):

```bash
git rm -r plugins/cc-func-understand/skills/func-understand/scripts/test/fixtures/basic/node_modules/@types
```

- [ ] **Step 2: 既存テストの `basename` を `shorten` に更新する**

`test/graph-builder.test.mjs` の 2 箇所を修正:

(a) `basic: 上流はルーティング層…` テスト内:

```js
  const boundary = byName(g, 'shorten');
```

(それ以外のアサーション行は変更しない)

(b) `外部境界ノードはシンボル単位で重複排除される…` テスト:

```js
test('外部境界ノードはシンボル単位で重複排除される(複数の呼び出し元があっても1ノード)', () => {
  // basic fixture: getUser が直接 shorten を呼び、formatName(getUser の下流)も shorten を呼ぶ。
  // 呼び出し元が2つあっても external-boundary ノードは1個に集約されるべき。
  const g = graphFor('basic', 'getUser');
  const boundaryNodes = g.nodes.filter((n) => n.kind === 'external-boundary' && n.name === 'shorten');
  assert.equal(boundaryNodes.length, 1, 'shorten は1ノードに集約される');
  const boundary = boundaryNodes[0];
  const edgesToBoundary = g.edges.filter((e) => e.to === boundary.id);
  assert.ok(edgesToBoundary.length >= 2, `複数の呼び出し元から同一境界ノードへエッジが張られる(実際: ${edgesToBoundary.length})`);
  const callers = new Set(edgesToBoundary.map((e) => e.from));
  assert.ok(callers.has(byName(g, 'getUser').id));
  assert.ok(callers.has(byName(g, 'formatName').id));
});
```

- [ ] **Step 3: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: 全テスト PASS(挙動変更なし・境界ノードの名前だけ変わった)

- [ ] **Step 4: コミット**

```bash
cd /Users/ryutoharaguchi/develop/cc-plugins
git add -A plugins/cc-func-understand/skills/func-understand/scripts/test
git commit -m "test(cc-func-understand): basic fixture の外部境界を fake-lib に差し替え(@types/node 非依存化)"
```

---

### Task 3: stepDirection での stdlib 除外 + stdlib fixture

**Files:**
- Modify: `lib/graph-builder.mjs`(import 追加 + `stepDirection` 内 1 行)
- Create: `test/fixtures/stdlib/tsconfig.json`
- Create: `test/fixtures/stdlib/src/main.ts`
- Create: `test/fixtures/stdlib/node_modules/fake-pkg/package.json`
- Create: `test/fixtures/stdlib/node_modules/fake-pkg/index.d.ts`
- Create: `test/fixtures/stdlib/node_modules/@types/node/index.d.ts`
- Test: `test/graph-builder.test.mjs`(統合テスト 1 件追加)

**Interfaces:**
- Consumes: Task 1 の `classifySymbolFile(program, file)`、既存の `stepDirection`(`graph-builder.mjs` 内 non-export 関数、シグネチャ `(ts, proj, ctx, direction, entry, queue)`)
- Produces: `buildGraph` / `continueUpstream` の出力から stdlib ノード・stdlib へのエッジが消える(公開 API のシグネチャは不変)

- [ ] **Step 1: stdlib fixture を作る**

`test/fixtures/stdlib/tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" }, "include": ["src"] }
```

`test/fixtures/stdlib/node_modules/fake-pkg/package.json`:

```json
{ "name": "fake-pkg", "version": "1.0.0", "types": "index.d.ts" }
```

`test/fixtures/stdlib/node_modules/fake-pkg/index.d.ts`:

```ts
export declare function transform(s: string): string;
```

`test/fixtures/stdlib/node_modules/@types/node/index.d.ts`(basic から移設したスタブと同内容):

```ts
declare module "node:path" {
  export function basename(p: string, ext?: string): string;
}
```

`test/fixtures/stdlib/src/main.ts`:

```ts
import { transform } from "fake-pkg";
import { basename } from "node:path";

export function label(s: string): string {
  return `[${s}]`;
}

export function summarize(items: string[]): string {
  const blocks: string[] = [];
  const seen = new Map<string, string>();
  seen.get("k");
  blocks.push(label(basename("/tmp/x")));
  const mapped = items.map((i) => i);
  return transform(mapped.join("\n")) + blocks.join("");
}
```

- [ ] **Step 2: 失敗する統合テストを書く**

`test/graph-builder.test.mjs` の末尾に追加:

```js
test('stdlib: TS 標準ライブラリ / Node 組み込みはノード化されず、npm 境界と内部エッジは残る', () => {
  // maxNodes: 3 は summarize + label + transform でちょうど埋まる値。
  // stdlib が予算を消費したり frontier に積まれたりすると truncation が発生するので、
  // 「除外が maxNodes チェックより前で効いている」ことまで検証できる。
  const g = graphFor('stdlib', 'summarize', { maxNodes: 3 });
  for (const name of ['push', 'map', 'join', 'get', 'basename']) {
    assert.equal(byName(g, name), undefined, `${name} はノード化されない`);
  }
  const helper = byName(g, 'label');
  assert.ok(helper, 'リポ内定義の label は下流ノードとして残る');
  assert.equal(helper.downstreamDistance, 1);
  assert.ok(g.edges.some((e) => e.from === byName(g, 'summarize').id && e.to === helper.id));
  const boundary = byName(g, 'transform');
  assert.ok(boundary, 'npm パッケージは境界ノードとして残る');
  assert.equal(boundary.kind, 'external-boundary');
  assert.equal(g.truncation, null, 'stdlib が maxNodes 予算や truncation.frontier を汚さない');
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/graph-builder.test.mjs`
Expected: 追加テストのみ FAIL(`push` 等がノード化されている / truncation が非 null)。既存テストは PASS。

- [ ] **Step 4: stepDirection に除外を実装する**

`lib/graph-builder.mjs` の import に追加:

```js
import { classifySymbolFile } from './symbol-classifier.mjs';
```

`stepDirection` の for ループ先頭(`const peerItem = ...` の直後、maxNodes チェックの**前**)に追加:

```js
    // TS 標準ライブラリ / Node 組み込みはノード化しない。maxNodes チェックより前に
    // 弾くことで、stdlib が予算を消費したり truncation.frontier を汚したりしない
    // (誤った「打ち切られた」案内を防ぐ)。
    if (classifySymbolFile(proj.program, peerItem.file) === 'stdlib') continue;
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/graph-builder.test.mjs`
Expected: 全 PASS(追加分含む)

- [ ] **Step 6: 全 unit テスト + smoke を実行する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test && npm run test:smoke`
Expected: unit 全 PASS + smoke 4/4 PASS(smoke の callback / xss fixture は stdlib 解決シンボルを含まないため影響なし)

- [ ] **Step 7: コミット**

```bash
cd /Users/ryutoharaguchi/develop/cc-plugins
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/graph-builder.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test
git commit -m "feat(cc-func-understand): TS 標準ライブラリ / Node 組み込みをグラフから除外"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `plugins/cc-func-understand/README.md`(「既知の制約」節)
- Modify: `plugins/cc-func-understand/skills/func-understand/SKILL.md`(「5. 注意」節の既知の制約リスト)

**Interfaces:**
- Consumes: Task 3 の挙動(stdlib 非表示・npm 境界ノード維持)
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: README の「既知の制約」に追記する**

`README.md` の `## 既知の制約` リストの「動的な呼び出し」項目の直後に追加:

```markdown
- **標準ライブラリの呼び出しは表示されない**: `Array.prototype.push` などの TypeScript 標準ライブラリと、`fs.readFileSync` などの Node 組み込み(`@types/node` 解決)への呼び出しはノード化されない(独自定義コードに焦点を当てるため)。npm パッケージへの呼び出しは境界ノードとして表示される。
```

- [ ] **Step 2: SKILL.md の既知の制約に追記する**

`SKILL.md` の `## 5. 注意` 内の既知の制約リスト(「イベント経由・DI経由などの…」の項目の直後)に追加:

```markdown
  - TS 標準ライブラリ(`push`/`map` 等)と Node 組み込み(`@types/node` に解決されるもの)への呼び出しはノード化されない。npm パッケージへの呼び出しは境界ノードとして表示される。
```

- [ ] **Step 3: 最終確認(全テスト)とコミット**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test && npm run test:smoke`
Expected: 全 PASS

```bash
cd /Users/ryutoharaguchi/develop/cc-plugins
git add plugins/cc-func-understand/README.md plugins/cc-func-understand/skills/func-understand/SKILL.md
git commit -m "docs(cc-func-understand): 標準ライブラリ除外を既知の制約に追記"
```
