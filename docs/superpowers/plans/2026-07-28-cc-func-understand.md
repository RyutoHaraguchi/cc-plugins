# cc-func-understand 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/func-understand <関数名>` で TS/JS の呼び出しグラフを静的解析し、自己完結のインタラクティブ HTML として可視化する Claude Code プラグイン `cc-func-understand` を作る。

**Architecture:** スキル同梱の Node スクリプト群が TypeScript Compiler API(Call Hierarchy + findReferences)で決定的にグラフ JSON を抽出し、エージェントが距離2以内のノードに AI 要約を付与、最後に生成スクリプトがライブラリインライン済みテンプレートへ XSS 安全に埋め込んで単一 HTML を出力する。正確性が必要な工程はプログラム、意味理解は LLM という役割分担。

**Tech Stack:** Node.js (ESM, `.mjs`)、TypeScript 5系 Compiler API(バージョン固定同梱)、Cytoscape.js + dagre + cytoscape-dagre、highlight.js、node:test、Playwright(smoke test のみ)

**Spec:** `docs/superpowers/specs/2026-07-28-func-understand-design.md`(全要件の正はこちら。齟齬があればスペックが勝つ)

## Global Constraints

- TypeScript は `~5.9.3` に固定して `scripts/package.json` の dependencies で同梱。プロジェクト版は `typeof ts.createLanguageService === 'function'` を通過した場合のみ使用
- ノード数上限の既定は `300`。ノードあたり code 上限は `16KB`(超過は切り詰め + `codeTruncated: true`)
- module ノードの code は呼び出し箇所 ±10 行の抜粋
- AI 要約対象は `min(upstreamDistance ?? Infinity, downstreamDistance ?? Infinity) <= 2` のノードのみ
- HTML はライブラリ・CSS・JS・データすべてインライン埋め込み(CDN・外部リクエスト禁止)
- JSON 埋め込み時のエスケープ: `<` → `\u003c`、U+2028 → `\u2028`、U+2029 → `\u2029`(JSON.stringify 後に置換。ソース中では不可視文字を直接書かず必ずエスケープシーケンス表記で書く)
- DOM 挿入は `textContent` 基本、`innerHTML` は highlight.js の出力のみ
- ノード ID 形式は `<projectRoot からの相対パス>#<selectionSpan.start>`
- エッジ kind は `direct-call` | `callback-passed` の 2 種のみ
- ノード kind は `function` | `method` | `arrow` | `class` | `module` | `external-boundary` の 6 種のみ
- テストは `node --test`(解析側)と Playwright(UI smoke 4 点のみ)
- コミットは feature ブランチ `feat/cc-func-understand` 上で行う。コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける
- すべての新規ファイルは `plugins/cc-func-understand/` 配下(ドキュメントとルート README 更新を除く)

## ファイル構成(最終形)

```
plugins/cc-func-understand/
├── .claude-plugin/plugin.json
├── README.md
├── commands/func-understand.md
└── skills/func-understand/
    ├── SKILL.md
    ├── scripts/
    │   ├── package.json               # typescript 固定 + UI ライブラリ + playwright
    │   ├── analyze-callgraph.mjs      # CLI エントリ(引数パース・オーケストレーション)
    │   ├── generate-html.mjs          # グラフ JSON + テンプレート → 最終 HTML
    │   ├── lib/ts-loader.mjs          # TypeScript 本体の解決
    │   ├── lib/project-loader.mjs     # tsconfig 解決 + LanguageService 構築 + 内外判定
    │   ├── lib/target-resolver.mjs    # AST スキャン: 名前 → 宣言位置
    │   ├── lib/graph-builder.mjs      # Call Hierarchy BFS(direct-call)
    │   ├── lib/callback-edges.mjs     # findReferences 参照エッジ後処理
    │   └── test/
    │       ├── fixtures/basic/        ├── fixtures/callback/   ├── fixtures/cycle/
    │       ├── fixtures/duplicate-symbols/  ├── fixtures/barrel/  ├── fixtures/plain-js/
    │       ├── fixtures/xss/          # truncation は basic を --max-nodes 小で流用
    │       ├── ts-loader.test.mjs     ├── project-loader.test.mjs
    │       ├── target-resolver.test.mjs  ├── graph-builder.test.mjs
    │       ├── callback-edges.test.mjs   ├── cli.test.mjs
    │       ├── generate-html.test.mjs
    │       └── smoke.spec.mjs         # Playwright
    └── templates/
        ├── viewer.html                # テンプレート骨格(プレースホルダ入り)
        ├── viewer.css
        └── viewer.js                  # UI ロジック(生成時に viewer.html へ埋め込み)
```

---

### Task 1: ブランチ作成・プラグインスケルトン・ts-loader

**Files:**
- Create: `plugins/cc-func-understand/.claude-plugin/plugin.json`
- Create: `plugins/cc-func-understand/skills/func-understand/scripts/package.json`
- Create: `plugins/cc-func-understand/skills/func-understand/scripts/lib/ts-loader.mjs`
- Test: `plugins/cc-func-understand/skills/func-understand/scripts/test/ts-loader.test.mjs`

**Interfaces:**
- Produces: `loadTypeScript(projectRoot: string) -> { ts, source: 'project'|'bundled', version: string }`。`ts` は TypeScript モジュール本体。プロジェクト版が使えない・無い場合は同梱版に必ずフォールバックし、どちらも不可なら `Error` を throw

- [ ] **Step 1: feature ブランチを作成し、スペックと本計画をコミット**

```bash
cd /Users/ryutoharaguchi/develop/cc-plugins
git checkout -b feat/cc-func-understand
git add docs/superpowers/specs/2026-07-28-func-understand-design.md docs/superpowers/plans/2026-07-28-cc-func-understand.md
git commit -m "docs: cc-func-understand の設計スペックと実装計画を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: プラグインメタデータと scripts/package.json を作成**

`plugins/cc-func-understand/.claude-plugin/plugin.json`(cc-html の `plugin.json` と同形式。作成前に必ず `plugins/cc-html/.claude-plugin/plugin.json` を読んでキー構成を合わせること):

```json
{
  "name": "cc-func-understand",
  "version": "0.1.0",
  "description": "関数を軸に TS/JS の呼び出しグラフを静的解析し、自己完結のインタラクティブ HTML として可視化する"
}
```

`plugins/cc-func-understand/skills/func-understand/scripts/package.json`:

```json
{
  "name": "cc-func-understand-scripts",
  "private": true,
  "type": "module",
  "dependencies": {
    "typescript": "~5.9.3",
    "cytoscape": "3.30.4",
    "dagre": "0.8.5",
    "cytoscape-dagre": "2.5.0",
    "highlight.js": "11.11.1"
  },
  "devDependencies": {
    "@playwright/test": "1.49.1"
  },
  "scripts": {
    "test": "node --test test/",
    "test:smoke": "playwright test test/smoke.spec.mjs"
  }
}
```

`scripts/` ディレクトリで `npm install` を実行し、`node_modules/typescript/package.json` の version が `5.9.x` であることを確認する。`scripts/.gitignore` に `node_modules/` を書く。

- [ ] **Step 3: 失敗するテストを書く**

`scripts/test/ts-loader.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('typescript が無いプロジェクトでは同梱版 TS 5系にフォールバックする', () => {
  const { ts, source, version } = loadTypeScript(path.join(here, 'fixtures')); // node_modules なし
  assert.equal(source, 'bundled');
  assert.match(version, /^5\./);
  assert.equal(typeof ts.createLanguageService, 'function');
});

test('createLanguageService を持つプロジェクト版 TS があればそれを使う', () => {
  // scripts/ 自身は typescript ~5.9.3 を持つプロジェクトとして扱える
  const { source, version } = loadTypeScript(path.join(here, '..'));
  assert.equal(source, 'project');
  assert.match(version, /^5\.9\./);
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/ts-loader.test.mjs`
Expected: FAIL(`Cannot find module '../lib/ts-loader.mjs'`)

- [ ] **Step 5: ts-loader.mjs を実装**

```js
import { createRequire } from 'node:module';
import path from 'node:path';

/** プロジェクト版 TS(createLanguageService を持つ場合のみ)→ 同梱版の順で解決する */
export function loadTypeScript(projectRoot) {
  try {
    const projectRequire = createRequire(path.join(projectRoot, 'noop.js'));
    const ts = projectRequire('typescript');
    if (typeof ts.createLanguageService === 'function') {
      return { ts, source: 'project', version: ts.version };
    }
  } catch {
    // プロジェクトに typescript が無い → 同梱版へ
  }
  const bundledRequire = createRequire(import.meta.url);
  const ts = bundledRequire('typescript');
  if (typeof ts.createLanguageService !== 'function') {
    throw new Error(`同梱 TypeScript ${ts.version} に createLanguageService がありません。scripts/ で npm install を実行してください`);
  }
  return { ts, source: 'bundled', version: ts.version };
}
```

注意: `createRequire(path.join(projectRoot, 'noop.js'))` は projectRoot を起点に Node の解決規則で `node_modules/typescript` を探すための定石(noop.js は実在しなくてよい)。

- [ ] **Step 6: テストが通ることを確認**

Run: `node --test test/ts-loader.test.mjs`
Expected: 2 tests PASS

- [ ] **Step 7: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): プラグインスケルトンと TypeScript ローダーを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: fixture (basic / plain-js) と project-loader

**Files:**
- Create: `scripts/test/fixtures/basic/`(tsconfig.json + src 3 ファイル)
- Create: `scripts/test/fixtures/plain-js/`(tsconfig なし)
- Create: `scripts/lib/project-loader.mjs`
- Test: `scripts/test/project-loader.test.mjs`

(以降、パスはすべて `plugins/cc-func-understand/skills/func-understand/` からの相対)

**Interfaces:**
- Consumes: `loadTypeScript` (Task 1)
- Produces: `loadProject(ts, projectRoot: string, tsconfigOverride?: string) -> { service, program, fileNames: string[], tsconfigPath: string|null, isInternal(fileName: string): boolean }`。`service` は `ts.LanguageService`、`isInternal` は「program の rootFiles に含まれるか」で判定(パス文字列判定は使わない)

- [ ] **Step 1: basic fixture を作成(ルーティング → サービス → ユーティリティの 3 層)**

`test/fixtures/basic/tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" }, "include": ["src"] }
```

`test/fixtures/basic/src/routes.ts`:

```ts
import { getUser } from "./service.js";

export function handleGetUser(id: string): string {
  return getUser(id);
}
```

`test/fixtures/basic/src/service.ts`:

```ts
import { formatName } from "./util.js";
import { basename } from "node:path";

export function getUser(id: string): string {
  return formatName(id) + basename("/tmp/x");
}
```

`test/fixtures/basic/src/util.ts`:

```ts
export function formatName(id: string): string {
  return `user-${id}`;
}
```

※ `node:path` の `basename` は「外部境界ノード」検証用。fixture に `package.json` は不要(`@types/node` 未解決で境界扱いになっても、外部である事実は変わらないためテストは通る)。

- [ ] **Step 2: plain-js fixture を作成(tsconfig なし)**

`test/fixtures/plain-js/index.js`:

```js
import { helper } from "./helper.js";

export function main() {
  return helper() + 1;
}
```

`test/fixtures/plain-js/helper.js`:

```js
export function helper() {
  return 41;
}
```

- [ ] **Step 3: 失敗するテストを書く**

`test/project-loader.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

test('tsconfig ありのプロジェクトを読み、rootFiles を internal と判定する', () => {
  const root = path.join(here, 'fixtures/basic');
  const proj = loadProject(ts, root);
  assert.ok(proj.tsconfigPath.endsWith('tsconfig.json'));
  assert.ok(proj.isInternal(path.join(root, 'src/service.ts')));
  assert.ok(!proj.isInternal(path.join(root, 'node_modules/x/index.d.ts')));
  assert.ok(proj.program.getSourceFile(path.join(root, 'src/routes.ts')));
});

test('tsconfig なしでは既定オプション(allowJs)で JS を読み込む', () => {
  const root = path.join(here, 'fixtures/plain-js');
  const proj = loadProject(ts, root);
  assert.equal(proj.tsconfigPath, null);
  assert.ok(proj.isInternal(path.join(root, 'helper.js')));
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `node --test test/project-loader.test.mjs`
Expected: FAIL(module not found)

- [ ] **Step 5: project-loader.mjs を実装**

```js
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next']);

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkFiles(path.join(dir, entry.name), acc);
    } else if (DEFAULT_EXTS.includes(path.extname(entry.name))) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

export function loadProject(ts, projectRoot, tsconfigOverride) {
  const configPath = tsconfigOverride
    ? path.resolve(projectRoot, tsconfigOverride)
    : (ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json') ?? null);

  let fileNames, options;
  if (configPath) {
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error) throw new Error(`tsconfig の読み込みに失敗: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
    fileNames = parsed.fileNames;
    options = parsed.options;
  } else {
    // スペック既定: allowJs: true, checkJs: false, module: esnext, moduleResolution: bundler, jsx: preserve
    options = {
      allowJs: true, checkJs: false,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
    };
    fileNames = walkFiles(projectRoot);
  }

  const host = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => '0',
    getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
    getCurrentDirectory: () => projectRoot,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    readFile: ts.sys.readFile,
    fileExists: ts.sys.fileExists,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const program = service.getProgram();
  const internalSet = new Set(fileNames.map((f) => path.normalize(f)));
  return {
    service,
    program,
    fileNames,
    tsconfigPath: configPath,
    isInternal: (f) => internalSet.has(path.normalize(f)),
  };
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `node --test test/project-loader.test.mjs`(および `node --test test/` で回帰確認)
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): プロジェクトローダーと basic/plain-js fixture を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: target-resolver(名前 → 宣言位置の AST スキャン)

**Files:**
- Create: `scripts/lib/target-resolver.mjs`
- Create: `scripts/test/fixtures/duplicate-symbols/`(tsconfig.json + src/dup.ts)
- Test: `scripts/test/target-resolver.test.mjs`

**Interfaces:**
- Consumes: `loadProject` の戻り値(`program`, `isInternal`)
- Produces:
  - `resolveTarget(ts, proj, { functionName, file, line }, projectRoot) -> ResolveResult`
  - `ResolveResult` は次のいずれか:
    - `{ status: 'resolved', declaration: Decl }`
    - `{ status: 'ambiguous', candidates: Decl[] }`
    - `{ status: 'not-found', suggestions: Decl[] }`(部分一致・大文字小文字無視の近似候補)
    - `{ status: 'unsupported-anonymous' }`
  - `Decl = { file, relFile, name, containerName: string|null, kind: 'function'|'method'|'arrow', selectionStart: number, startLine: number, endLine: number, signature: string }`
  - `selectionStart` は**名前識別子の getStart()**(prepareCallHierarchy に渡す位置)。`startLine/endLine` は 1-index。arrow は親 VariableDeclaration(親 VariableStatement があればそこ)までを宣言範囲とする
  - `collectDeclarations(ts, proj) -> Decl[]` もエクスポート(Task 5 の包含関数逆引きで再利用)

- [ ] **Step 1: duplicate-symbols fixture を作成**

`test/fixtures/duplicate-symbols/tsconfig.json` は basic と同内容。`src/dup.ts`:

```ts
export class AdminService {
  save(x: string): string { return "admin:" + x; }
}

export class UserService {
  save(x: string): string { return "user:" + x; }
}

export const save = (x: string): string => "fn:" + x;

export default () => "anonymous";
```

- [ ] **Step 2: 失敗するテストを書く**

`test/target-resolver.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

function proj(name) {
  const root = path.join(here, 'fixtures', name);
  return { root, proj: loadProject(ts, root) };
}

test('一意な関数名は resolved になり、名前位置と行範囲を返す', () => {
  const { root, proj: p } = proj('basic');
  const r = resolveTarget(ts, p, { functionName: 'getUser' }, root);
  assert.equal(r.status, 'resolved');
  assert.equal(r.declaration.name, 'getUser');
  assert.equal(r.declaration.relFile, 'src/service.ts');
  assert.equal(r.declaration.kind, 'function');
  assert.ok(r.declaration.selectionStart > 0);
});

test('"getUser()" のように括弧付きで指定しても解決できる', () => {
  const { root, proj: p } = proj('basic');
  const r = resolveTarget(ts, p, { functionName: 'getUser()' }, root);
  assert.equal(r.status, 'resolved');
});

test('同名 3 宣言(2 クラスの同名メソッド + arrow)は ambiguous で containerName 付き候補を返す', () => {
  const { root, proj: p } = proj('duplicate-symbols');
  const r = resolveTarget(ts, p, { functionName: 'save' }, root);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates.length, 3);
  const containers = r.candidates.map((c) => c.containerName).sort();
  assert.deepEqual(containers, ['AdminService', 'UserService', null].sort());
});

test('--file --line 指定で候補を一意に絞れる', () => {
  const { root, proj: p } = proj('duplicate-symbols');
  const all = resolveTarget(ts, p, { functionName: 'save' }, root);
  const admin = all.candidates.find((c) => c.containerName === 'AdminService');
  const r = resolveTarget(ts, p, { functionName: 'save', file: 'src/dup.ts', line: admin.startLine }, root);
  assert.equal(r.status, 'resolved');
  assert.equal(r.declaration.containerName, 'AdminService');
});

test('見つからない名前は not-found と近似候補(部分一致・大小無視)を返す', () => {
  const { root, proj: p } = proj('basic');
  const r = resolveTarget(ts, p, { functionName: 'getuse' }, root);
  assert.equal(r.status, 'not-found');
  assert.ok(r.suggestions.some((s) => s.name === 'getUser'));
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `node --test test/target-resolver.test.mjs`
Expected: FAIL(module not found)

- [ ] **Step 4: target-resolver.mjs を実装**

実装の要点(全体は 150 行程度):

```js
import path from 'node:path';

export function collectDeclarations(ts, proj) {
  const decls = [];
  for (const sf of proj.program.getSourceFiles()) {
    if (!proj.isInternal(sf.fileName)) continue;
    const visit = (node) => {
      let nameNode = null, kind = null, containerName = null, rangeNode = node;
      if (ts.isFunctionDeclaration(node) && node.name) {
        nameNode = node.name; kind = 'function';
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        nameNode = node.name; kind = 'method';
        const owner = node.parent;
        containerName = (ts.isClassDeclaration(owner) || ts.isClassExpression(owner)) && owner.name ? owner.name.text : null;
      } else if (
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        nameNode = node.name; kind = 'arrow';
        // 宣言範囲は VariableStatement 全体(export const foo = ... を丸ごと)
        rangeNode = node.parent?.parent && ts.isVariableStatement(node.parent.parent) ? node.parent.parent : node;
      } else if (
        ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        nameNode = node.name; kind = 'method';
      }
      if (nameNode) {
        const start = sf.getLineAndCharacterOfPosition(rangeNode.getStart(sf));
        const end = sf.getLineAndCharacterOfPosition(rangeNode.getEnd());
        decls.push({
          file: sf.fileName,
          relFile: path.relative(proj.projectRoot ?? '', sf.fileName), // 呼び出し側で projectRoot を渡して整形
          name: nameNode.text,
          containerName,
          kind,
          selectionStart: nameNode.getStart(sf),
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: sf.text.slice(rangeNode.getStart(sf), rangeNode.getEnd()).split('\n')[0].slice(0, 120),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return decls;
}

export function resolveTarget(ts, proj, { functionName, file, line }, projectRoot) {
  proj.projectRoot = projectRoot;
  const name = functionName.replace(/\(\)\s*$/, '').trim();
  const decls = collectDeclarations(ts, proj)
    .map((d) => ({ ...d, relFile: path.relative(projectRoot, d.file) }));
  let matched = decls.filter((d) => d.name === name);
  if (file) matched = matched.filter((d) => d.relFile === file || d.relFile.endsWith(file));
  if (line != null) matched = matched.filter((d) => d.startLine <= line && line <= d.endLine);
  if (matched.length === 1) return { status: 'resolved', declaration: matched[0] };
  if (matched.length > 1) return { status: 'ambiguous', candidates: matched };
  const lower = name.toLowerCase();
  const suggestions = decls.filter((d) => d.name.toLowerCase().includes(lower)).slice(0, 10);
  return { status: 'not-found', suggestions };
}
```

匿名 default export は `collectDeclarations` が名前を持たないため収集されない = 指定不能(スペック通り)。`unsupported-anonymous` は CLI 層(Task 6)で `--line` が匿名関数のみを指す場合に返す。

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/target-resolver.test.mjs` および `node --test test/`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): ターゲット位置解決(ASTスキャン)を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: graph-builder(Call Hierarchy BFS、direct-call エッジ)

**Files:**
- Create: `scripts/lib/graph-builder.mjs`
- Create: `scripts/test/fixtures/cycle/`、`scripts/test/fixtures/barrel/`
- Test: `scripts/test/graph-builder.test.mjs`

**Interfaces:**
- Consumes: `loadProject` の戻り値、`resolveTarget` の `declaration`
- Produces: `buildGraph(ts, proj, targetDecl, { projectRoot, maxNodes = 300, upstreamDepth = Infinity, downstreamDepth = Infinity }) -> Graph`
  - `Graph` はスペックのグラフ JSON スキーマそのもの(`target`, `meta` は CLI 層で追記するため未設定でよい、`truncation`, `nodes[]`, `edges[]`)
  - ノード ID: `${relFile}#${selectionSpan.start}`(外部境界は `${basename}#ext-${連番}`)
  - `nodes[].kind` は Call Hierarchy item の `kind` を次で写像: `ScriptElementKind.moduleElement → 'module'`、`classElement → 'class'`、`memberFunctionElement → 'method'`、それ以外の関数様 → `'function'`。ただし **arrow は AST 判定で上書き**(`collectDeclarations` の結果と selectionStart 照合)
  - `edges[]` は `{ from, to, kind: 'direct-call', callLines: number[] }`(同一ペアはマージ)
  - 内部関数ノードには `_selection = { file, start }` を内部プロパティとして保持(Task 5 が findReferences に使う。JSON 出力前に CLI 層で削除)

- [ ] **Step 1: cycle / barrel fixture を作成**

`test/fixtures/cycle/tsconfig.json` は basic と同内容。`src/cycle.ts`:

```ts
export function pingA(n: number): number {
  return n <= 0 ? 0 : pingB(n - 1);
}
export function pingB(n: number): number {
  return n <= 0 ? 1 : pingA(n - 1);
}
```

`test/fixtures/barrel/tsconfig.json` は basic と同内容。`src/impl.ts`:

```ts
export function realImpl(): string {
  return "real";
}
```

`src/index.ts`(バレル):

```ts
export { realImpl } from "./impl.js";
```

`src/consumer.ts`:

```ts
import { realImpl } from "./index.js";
export function consume(): string {
  return realImpl();
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/graph-builder.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';
import { buildGraph } from '../lib/graph-builder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

function graphFor(fixture, fn, opts = {}) {
  const projectRoot = path.join(here, 'fixtures', fixture);
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: fn }, projectRoot);
  assert.equal(r.status, 'resolved');
  return buildGraph(ts, proj, r.declaration, { projectRoot, ...opts });
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);

test('basic: 上流はルーティング層、下流はユーティリティと外部境界まで辿る', () => {
  const g = graphFor('basic', 'getUser');
  const target = byName(g, 'getUser');
  assert.equal(target.upstreamDistance, 0);
  assert.equal(target.downstreamDistance, 0);
  assert.equal(byName(g, 'handleGetUser').upstreamDistance, 1);   // 上流
  assert.equal(byName(g, 'formatName').downstreamDistance, 1);    // 下流
  const boundary = byName(g, 'basename');
  assert.equal(boundary.kind, 'external-boundary');
  assert.equal(boundary.internal, false);
  assert.equal(boundary.code, undefined);                          // 境界は code なし
  const e = g.edges.find((x) => x.from === target.id && x.to === byName(g, 'formatName').id);
  assert.equal(e.kind, 'direct-call');
  assert.ok(e.callLines.length >= 1);
});

test('cycle: 相互再帰は方向別 distance を持ち無限ループしない', () => {
  const g = graphFor('cycle', 'pingA');
  const b = byName(g, 'pingB');
  assert.equal(b.upstreamDistance, 1);    // pingB は pingA を呼ぶ(上流)
  assert.equal(b.downstreamDistance, 1);  // pingA は pingB を呼ぶ(下流)
  assert.ok(g.nodes.length <= 3); // pingA, pingB(+ module があっても3以下)
});

test('barrel: バレル経由の呼び出しは元宣言ノードに解決される', () => {
  const g = graphFor('barrel', 'realImpl');
  const caller = byName(g, 'consume');
  assert.ok(caller, 'バレル経由でも consumer が上流として検出される');
  assert.equal(caller.upstreamDistance, 1);
});

test('truncation: maxNodes 到達で打ち切り情報を記録する', () => {
  const g = graphFor('basic', 'getUser', { maxNodes: 2 });
  assert.ok(g.truncation);
  assert.equal(g.truncation.reason, 'max-nodes');
  assert.ok(typeof g.truncation.upstreamCount === 'number');
  assert.ok(typeof g.truncation.downstreamCount === 'number');
  assert.ok(Array.isArray(g.truncation.frontier));
});

test('code はノードあたり 16KB で切り詰められる', () => {
  const g = graphFor('basic', 'getUser');
  for (const n of g.nodes.filter((n) => n.internal)) {
    assert.ok(Buffer.byteLength(n.code, 'utf8') <= 16 * 1024);
    assert.equal(typeof n.codeTruncated, 'boolean');
  }
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `node --test test/graph-builder.test.mjs`
Expected: FAIL(module not found)

- [ ] **Step 4: graph-builder.mjs を実装**

実装の骨子(全体 250 行程度)。重要な決定はすべてここに書いてあるので、これに従うこと:

```js
import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';

const MAX_CODE_BYTES = 16 * 1024;
const MODULE_EXCERPT_LINES = 10;

export function buildGraph(ts, proj, targetDecl, opts) {
  const { projectRoot, maxNodes = 300, upstreamDepth = Infinity, downstreamDepth = Infinity } = opts;
  const nodes = new Map();   // id -> node
  const edges = new Map();   // `${from}->${to}` -> edge(callLines をマージ)
  let extSeq = 0;
  // arrow 上書き判定用: `${file}#${selectionStart}` -> kind
  const declKinds = new Map(collectDeclarations(ts, proj).map((d) => [`${d.file}#${d.selectionStart}`, d.kind]));

  const prepare = (file, pos) => {
    const item = proj.service.prepareCallHierarchy(file, pos);
    if (!item) return null;
    return Array.isArray(item) ? item[0] : item;
  };

  const itemToNode = (item, excerptSpan) => { /* id 生成・kind 写像・code 抽出して nodes に upsert、既存なら返す */ };
  // kind 写像: item.kind === ts.ScriptElementKind.moduleElement → 'module'
  //           item.kind === ts.ScriptElementKind.classElement → 'class'
  //           item.kind === ts.ScriptElementKind.memberFunctionElement → 'method'
  //           それ以外 → declKinds で 'arrow' なら 'arrow'、さもなくば 'function'
  // 内外: proj.isInternal(item.file)。外部なら { id: `${basename}#ext-${extSeq++}`, kind: 'external-boundary',
  //        internal: false, name: item.name } のみ(file/code/行は付けない)
  // code: 内部ノードは file テキストの span 範囲。module ノードは excerptSpan(呼び出し箇所)±10 行の抜粋。
  //        16KB 超は切って codeTruncated: true
  // 内部ノードは _selection = { file: item.file, start: item.selectionSpan.start } を保持

  const targetItem = prepare(targetDecl.file, targetDecl.selectionStart);
  if (!targetItem) throw new Error('prepareCallHierarchy がターゲットを解決できませんでした');
  const targetNode = itemToNode(targetItem);
  targetNode.upstreamDistance = 0;
  targetNode.downstreamDistance = 0;

  // 上下流の queue を交互に消費(スペック: 片方向の高 fan-out 対策)
  const upQ = [{ node: targetNode, item: targetItem, depth: 0 }];
  const downQ = [{ node: targetNode, item: targetItem, depth: 0 }];
  const visitedUp = new Set([targetNode.id]);
  const visitedDown = new Set([targetNode.id]);
  let truncated = null;

  const step = (queue, direction) => {
    const { node, item, depth } = queue.shift();
    const limit = direction === 'up' ? upstreamDepth : downstreamDepth;
    if (depth >= limit || !node.internal) return;
    const calls = direction === 'up'
      ? proj.service.provideCallHierarchyIncomingCalls(item.file, item.selectionSpan.start)
      : proj.service.provideCallHierarchyOutgoingCalls(item.file, item.selectionSpan.start);
    for (const call of calls ?? []) {
      const peerItem = direction === 'up' ? call.from : call.to;
      if (nodes.size >= maxNodes && !hasNode(peerItem)) {
        truncated ??= { reason: 'max-nodes', frontier: [] };
        truncated.frontier.push(peerItem.name);
        continue;
      }
      const peer = itemToNode(peerItem, call.fromSpans[0]);
      const lines = call.fromSpans.map((s) => lineOf(direction === 'up' ? peerItem.file : item.file, s.start));
      const [from, to] = direction === 'up' ? [peer.id, node.id] : [node.id, peer.id];
      upsertEdge(from, to, 'direct-call', lines);
      const visited = direction === 'up' ? visitedUp : visitedDown;
      if (!visited.has(peer.id)) {
        visited.add(peer.id);
        const key = direction === 'up' ? 'upstreamDistance' : 'downstreamDistance';
        if (peer[key] == null) peer[key] = depth + 1;
        if (peer.internal) queue.push({ node: peer, item: peerItem, depth: depth + 1 });
      }
    }
  };

  while (upQ.length || downQ.length) {
    if (upQ.length) step(upQ, 'up');
    if (downQ.length) step(downQ, 'down');
  }

  if (truncated) {
    truncated.upstreamCount = [...nodes.values()].filter((n) => n.upstreamDistance != null && n.upstreamDistance > 0).length;
    truncated.downstreamCount = [...nodes.values()].filter((n) => n.downstreamDistance != null && n.downstreamDistance > 0).length;
  }
  return { target: targetNode.id, truncation: truncated, nodes: [...nodes.values()], edges: [...edges.values()] };
}
```

補助関数 `lineOf(file, pos)` は sourceFile の `getLineAndCharacterOfPosition(pos).line + 1`。`upsertEdge` は同一 `from->to` の `callLines` をマージしユニーク化・昇順ソート。`hasNode(item)` は itemToNode と同じ id 規則で存在確認(境界ノードは常に新規なので `nodes.size >= maxNodes` なら追加しない)。

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/graph-builder.test.mjs` および `node --test test/`
Expected: PASS。barrel テストが FAIL する場合、原因が「incoming が barrel(index.ts)止まり」なら実挙動を確認の上、consumer 到達が真である限りテストの期待を実挙動に合わせて調整してよい(スペックの検証では元宣言に解決された)

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): Call Hierarchy BFS によるグラフ構築を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: callback-edges(findReferences 参照エッジ + 上流継続)

**Files:**
- Create: `scripts/lib/callback-edges.mjs`
- Create: `scripts/test/fixtures/callback/`
- Test: `scripts/test/callback-edges.test.mjs`

**Interfaces:**
- Consumes: `buildGraph` の戻り値(内部ノードの `_selection`)、`proj.service.findReferences`
- Produces: `addCallbackEdges(ts, proj, graph, opts) -> graph`(同一オブジェクトを拡張して返す)
  - 追加エッジ: `{ from: <参照元の包含関数ノードid>, to: <参照されたノードid>, kind: 'callback-passed', callLines: [...] }`
  - 参照元の包含関数が未知ノードなら追加し、**そこから上流 BFS を継続**(graph-builder の step 相当を再利用。maxNodes 制約は共有)
  - 収束するまで反復(新ノードが増えなくなるまで)

- [ ] **Step 1: callback fixture を作成**

`test/fixtures/callback/tsconfig.json` は basic と同内容。`src/handlers.ts`:

```ts
export function itemHandler(id: string): string {
  return `item:${id}`;
}
```

`src/app.ts`(擬似 Express。外部依存なしで参照登録パターンを再現):

```ts
import { itemHandler } from "./handlers.js";

type Handler = (id: string) => string;
const routes: Array<[string, Handler]> = [];

function register(path: string, handler: Handler): void {
  routes.push([path, handler]);
}

export function setupRoutes(): void {
  register("/item", itemHandler);          // 名前渡し(callback-passed)
}

export function processAll(ids: string[]): string[] {
  return ids.map(itemHandler);             // 高階関数への名前渡し
}
```

`src/main.ts`(setupRoutes のさらに上流):

```ts
import { setupRoutes } from "./app.js";
export function boot(): void {
  setupRoutes();
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/callback-edges.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';
import { buildGraph } from '../lib/graph-builder.mjs';
import { addCallbackEdges } from '../lib/callback-edges.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

function fullGraph(fn) {
  const projectRoot = path.join(here, 'fixtures/callback');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: fn }, projectRoot);
  const g = buildGraph(ts, proj, r.declaration, { projectRoot });
  return addCallbackEdges(ts, proj, g, { projectRoot });
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);

test('Call Hierarchy 単独では検出できない名前渡しが callback-passed エッジになる', () => {
  const g = fullGraph('itemHandler');
  const setup = byName(g, 'setupRoutes');
  const processAll = byName(g, 'processAll');
  assert.ok(setup, 'register("/item", itemHandler) の登録元が検出される');
  assert.ok(processAll, 'ids.map(itemHandler) の利用元が検出される');
  const target = byName(g, 'itemHandler');
  const e1 = g.edges.find((x) => x.from === setup.id && x.to === target.id);
  assert.equal(e1.kind, 'callback-passed');
  const e2 = g.edges.find((x) => x.from === processAll.id && x.to === target.id);
  assert.equal(e2.kind, 'callback-passed');
});

test('参照元からさらに上流 BFS が継続し boot まで到達する', () => {
  const g = fullGraph('itemHandler');
  assert.ok(byName(g, 'boot'), 'setupRoutes の呼び出し元 boot に到達(ルーティング層まで遡れる)');
});

test('直接呼び出しは callback-passed として二重計上されない', () => {
  const projectRoot = path.join(here, 'fixtures/basic');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: 'formatName' }, projectRoot);
  const g = addCallbackEdges(ts, proj, buildGraph(ts, proj, r.declaration, { projectRoot }), { projectRoot });
  assert.ok(!g.edges.some((e) => e.kind === 'callback-passed'), 'basic には名前渡しが無い');
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `node --test test/callback-edges.test.mjs`
Expected: FAIL(module not found)

- [ ] **Step 4: callback-edges.mjs を実装**

実装の要点:

```js
// 各内部関数ノード(kind が function|method|arrow)について:
//   refs = proj.service.findReferences(node._selection.file, node._selection.start)
//   各 reference について除外判定:
//     1. isDefinition → skip
//     2. import/export 文中(参照位置の祖先に ImportDeclaration/ExportDeclaration)→ skip
//     3. 「呼び出し式」→ skip:
//        参照位置の Identifier n について、n(または n を含む PropertyAccessExpression)が
//        親 CallExpression の .expression である場合
//     4. 既存 direct-call エッジと同一行 → skip(二重計上防止)
//   残った参照 = 名前渡し。参照位置を含む最内の関数様宣言(collectDeclarations の行範囲で逆引き。
//   無ければそのファイルの module ノードを新設)を from とし、callback-passed エッジを追加。
//   from が新ノードなら nodes に追加(upstreamDistance = to の upstreamDistance + 1)し、
//   graph-builder と同じ incoming BFS でそこから上流を継続する。
// 全体を「新ノードが増えなくなるまで」反復(worklist)。maxNodes 到達で truncation に追記して停止。
```

「呼び出し式か」の判定コード(核心部):

```js
function isCallExpressionCallee(ts, sf, refStart) {
  const node = findIdentifierAt(ts, sf, refStart);   // getTouchingToken 相当の再帰探索
  if (!node) return false;
  let callee = node;
  while (callee.parent && ts.isPropertyAccessExpression(callee.parent)) callee = callee.parent;
  return callee.parent && ts.isCallExpression(callee.parent) && callee.parent.expression === callee;
}
```

上流 BFS の再利用のため、Task 4 の `step` 相当ロジックを graph-builder から `continueUpstream(ts, proj, graph, startNodes, opts)` としてエクスポートするリファクタを行ってよい(その場合 graph-builder のテストが回帰しないこと)。

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/`(全テスト)
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): findReferences による callback-passed 参照エッジを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CLI エントリ(analyze-callgraph.mjs)

**Files:**
- Create: `scripts/analyze-callgraph.mjs`
- Create: `scripts/test/fixtures/xss/`
- Test: `scripts/test/cli.test.mjs`

**Interfaces:**
- Consumes: Task 1〜5 の全モジュール
- Produces: CLI 契約(SKILL.md と generate-html が依存):
  - 引数: `--project <dir> --function <name> [--file <rel>] [--line <n>] [--tsconfig <path>] [--upstream-depth <n>] [--downstream-depth <n>] [--max-nodes <n>] --out <json>`
  - 成功: `--out` にグラフ JSON を書き exit 0。stdout に `{"status":"ok","nodes":N,"edges":M,"truncated":bool,"out":"<path>"}` を 1 行出力
  - 要選択: `--out` に書かず、stdout に `{"status":"ambiguous","candidates":[...]}` または `{"status":"not-found","suggestions":[...]}` を出力し exit 2
  - エラー: stderr にメッセージ、exit 1
  - グラフ JSON に `meta: { tsVersion, tsSource, tsconfig, limitations }` を付与。`limitations` は常に `"dynamic-calls"` を含み、tsconfig が project references を持つ場合(`references` キー存在)は `"project-references"` を追加
  - ノードの `_selection` は出力前に削除する

- [ ] **Step 1: xss fixture を作成**

`test/fixtures/xss/tsconfig.json` は basic と同内容。`src/evil.ts`:

```ts
export function renderPage(): string {
  const html = "</script><script>window.__xss_executed = true;</script>";
  const tricky = "line\u2028sep and <img src=x onerror=alert(1)>";
  return html + tricky + helperEvil();
}

export function helperEvil(): string {
  return "<div onclick=alert(2)>x</div>";
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/cli.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'analyze-callgraph.mjs');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-')), 'graph.json');

function run(args) {
  try {
    const stdout = execFileSync('node', [cli, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('basic を end-to-end で解析し、スキーマ通りの JSON を出力する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'getUser', '--out', out]);
  assert.equal(r.code, 0);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'ok');
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.match(g.meta.tsVersion, /^5\./);
  assert.ok(g.meta.limitations.includes('dynamic-calls'));
  assert.ok(g.target.includes('service.ts#'));
  assert.ok(g.nodes.every((n) => !('_selection' in n)));
  assert.ok(g.nodes.every((n) => ['function','method','arrow','class','module','external-boundary'].includes(n.kind)));
});

test('曖昧な関数名は exit 2 で候補一覧を返す', () => {
  const r = run(['--project', path.join(here, 'fixtures/duplicate-symbols'), '--function', 'save', '--out', tmp()]);
  assert.equal(r.code, 2);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'ambiguous');
  assert.equal(status.candidates.length, 3);
  assert.ok(status.candidates[0].relFile && status.candidates[0].startLine);
});

test('見つからない名前は exit 2 で近似候補を返す', () => {
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'nosuch', '--out', tmp()]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'not-found');
});

test('callback fixture で参照エッジ込みの解析ができる(統合)', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/callback'), '--function', 'itemHandler', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.edges.some((e) => e.kind === 'callback-passed'));
  assert.ok(g.nodes.some((n) => n.name === 'boot'));
});

test('xss fixture のコードが JSON 内にそのまま保持される(エスケープは HTML 生成側の責務)', () => {
  const out = tmp();
  run(['--project', path.join(here, 'fixtures/xss'), '--function', 'renderPage', '--out', out]);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.nodes.find((n) => n.name === 'renderPage').code.includes('</script>'));
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `node --test test/cli.test.mjs`
Expected: FAIL(CLI ファイルなし)

- [ ] **Step 4: analyze-callgraph.mjs を実装**

`node:util` の `parseArgs` で引数パース → `loadTypeScript` → `loadProject` → `resolveTarget` → 分岐(resolved 以外は status JSON を stdout に出して exit 2)→ `buildGraph` → `addCallbackEdges` → `meta` 付与・`_selection` 削除 → `--out` へ `JSON.stringify(graph, null, 2)` → status 1 行を stdout、exit 0。例外は `console.error(e.message)` + exit 1。

`meta.limitations`: 基本 `['dynamic-calls']`。`tsconfigPath` があり、その JSON に `references` キーがあれば `'project-references'` を push。

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): 解析 CLI エントリと統合テストを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: generate-html.mjs(XSS 安全な埋め込みとライブラリインライン)

**Files:**
- Create: `scripts/generate-html.mjs`
- Create: `templates/viewer.html`(骨格のみ。UI 実体は Task 8)
- Test: `scripts/test/generate-html.test.mjs`

**Interfaces:**
- Consumes: グラフ JSON(要約埋め込み済み)、`templates/viewer.html` / `viewer.css` / `viewer.js`、`node_modules` のライブラリ 4 種
- Produces:
  - CLI: `node generate-html.mjs --graph <json> --out <html> [--title <str>]`
  - `escapeJsonForScript(jsonString: string) -> string` をエクスポート(`<`→`\u003c`、U+2028→`\u2028`、U+2029→`\u2029`)
  - テンプレートのプレースホルダ契約(Task 8 の viewer.html が従う): `<!--__TITLE__-->` `<!--__LIBS__-->` `<!--__CSS__-->` `<!--__APP__-->` `<!--__DATA__-->`
  - `<!--__DATA__-->` は `<script type="application/json" id="graph-data">…</script>` に置換される
  - インラインするライブラリ(この順): `node_modules/cytoscape/dist/cytoscape.min.js`、`node_modules/dagre/dist/dagre.min.js`、`node_modules/cytoscape-dagre/cytoscape-dagre.js`、`node_modules/highlight.js/lib/` から core + typescript + javascript(highlight.js は `styles/github-dark.min.css` も `<!--__CSS__-->` に含める。ESM でなくブラウザグローバル版を選ぶこと。highlight.js はブラウザグローバル版が `node_modules/@highlightjs/cdn-assets` に無い場合、`npm i highlight.js` の `lib` は CJS のため、代わりに package `highlight.js` の `es/core` を esbuild せず使うのは不可 — その場合は依存を `@highlightjs/cdn-assets@11.11.1` に変更し `highlight.min.js` + `languages/typescript.min.js` を使うのが確実)

- [ ] **Step 1: viewer.html の骨格を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><!--__TITLE__--></title>
<style><!--__CSS__--></style>
</head>
<body>
<div id="app">
  <header id="banner"></header>
  <main>
    <div id="graph"></div>
    <aside id="detail"></aside>
  </main>
</div>
<!--__DATA__-->
<script><!--__LIBS__--></script>
<script><!--__APP__--></script>
</body>
</html>
```

`templates/viewer.css` と `templates/viewer.js` はこの時点では空ファイルで作成(Task 8 で実装)。

- [ ] **Step 2: 失敗するテストを書く**

`test/generate-html.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { escapeJsonForScript } from '../generate-html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('escapeJsonForScript は script 終端と行区切り文字を無害化する', () => {
  const json = JSON.stringify({ code: '</script><script>alert(1)</script>', sep: 'a\u2028b\u2029c' });
  const escaped = escapeJsonForScript(json);
  assert.ok(!escaped.includes('</script'));
  assert.ok(!escaped.includes('<'));
  assert.ok(!escaped.includes('\u2028') && !escaped.includes('\u2029'));
  assert.deepEqual(JSON.parse(escaped), JSON.parse(json)); // JSON として等価なまま
});

test('xss fixture のグラフから生成した HTML に生の </script> が現れない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-html-'));
  const graphPath = path.join(dir, 'g.json');
  const htmlPath = path.join(dir, 'out.html');
  execFileSync('node', [path.join(here, '..', 'analyze-callgraph.mjs'),
    '--project', path.join(here, 'fixtures/xss'), '--function', 'renderPage', '--out', graphPath]);
  execFileSync('node', [path.join(here, '..', 'generate-html.mjs'),
    '--graph', graphPath, '--out', htmlPath, '--title', 'xss-test']);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dataSection = html.slice(html.indexOf('id="graph-data"'));
  const dataBody = dataSection.slice(dataSection.indexOf('>') + 1, dataSection.indexOf('</script>'));
  assert.ok(!dataBody.includes('<'), 'データ部に生の < が無い');
  assert.ok(html.includes('cytoscape'), 'ライブラリがインラインされている');
  assert.ok(!/src\s*=\s*"https?:/.test(html) && !/href\s*=\s*"https?:/.test(html), '外部 URL 参照が無い');
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `node --test test/generate-html.test.mjs`
Expected: FAIL

- [ ] **Step 4: generate-html.mjs を実装**

```js
export function escapeJsonForScript(json) {
  return json
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
```

main 処理: graph JSON 読み込み → テンプレート読み込み → ライブラリファイル群を結合(各ファイル間に `;\n` を挟む)→ プレースホルダ置換(`String.prototype.replace` はドル記号の特殊解釈があるため、**必ず置換関数 `() => content` を使う**)→ `--out` に書き出し。`--title` 省略時は `graph.target` を使用。ライブラリのパス解決は `createRequire(import.meta.url).resolve('cytoscape/package.json')` 起点で行う。highlight.js の登録: APP 側で使うため、LIBS の末尾に `hljs.registerLanguage` 済みのグローバル `hljs` が存在するよう構成する(cdn-assets 版なら自動)。

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): XSS 安全な HTML 生成とライブラリインライン埋め込みを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: viewer UI(グラフ描画・展開・詳細・検索・パスハイライト)

**Files:**
- Modify: `templates/viewer.css`、`templates/viewer.js`(Task 7 で空作成済み)

**Interfaces:**
- Consumes: `#graph-data` の JSON(スペックのスキーマ)、グローバル `cytoscape` / `dagre` / `cytoscapeDagre` / `hljs`
- Produces: ブラウザ UI。Playwright(Task 9)が依存する DOM 契約:
  - `#graph` に cytoscape キャンバス。ノード要素の `data('id')` はグラフ JSON の node id
  - `#detail` 詳細パネル: `#detail .summary`(要約 or「要約未生成」)、`#detail pre code`(コード)、`#detail .loc`(`file:startLine`)
  - `#search` 検索入力。入力でマッチノードにフォーカスし該当ノードに `.search-hit` クラス相当の cytoscape スタイルを適用
  - 展開バッジ: cytoscape 複合ノードでなく、展開可能ノードのラベル末尾に `▸N`(上流)/`N◂`(下流)を表示し、**タップ位置がバッジ側 30% 領域なら展開・それ以外は詳細表示**…は実装が壊れやすいので採らない。代わりに: ノード通常タップ = 詳細、**ダブルタップ = 両方向展開、詳細パネル内の「上流を展開 (+N)」「下流を展開 (+N)」ボタン = 方向別展開**(スペックの「クリックと展開の分離」をボタンで実現)
  - `#banner` に meta(TS バージョン・tsconfig・limitations)と truncation 警告を表示

- [ ] **Step 1: viewer.js を実装(核心ロジック)**

構成(1 ファイル、~400 行、セクションコメントで区切る):

```js
// 1. データロード
const graph = JSON.parse(document.getElementById('graph-data').textContent);
const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
const outEdges = new Map(); // from -> edge[]
const inEdges = new Map();  // to -> edge[]
// graph.edges を両インデックスに登録

// 2. 可視状態管理
const visible = new Set();  // 初期: target + 距離1(両方向)のノード id
//   dist1 = min(upstreamDistance ?? Inf, downstreamDistance ?? Inf) <= 1
//   方向別の初期上限 20 件: 上流側・下流側それぞれ距離1ノードを 20 件まで。超過分は非表示のまま
//   (集約プレースホルダノードは作らず、展開ボタンの +N 表示で代替する — cytoscape 要素の増減が単純になる)

// 3. 描画
function render() {
  // visible のノードと、両端が visible のエッジだけで cy.elements を再構築し、
  // layout = { name: 'dagre', rankDir: 'LR' } を実行(表示中ノードのみレイアウト = スペック要件)
  // スタイル: target は背景色強調 + 大サイズ / external-boundary は点線枠 /
  //           callback-passed エッジは line-style: 'dashed' + label 'callback' /
  //           kind: module はグレー
}

// 4. 展開
function expandable(id, dir) { /* dir 側の隣接ノードで非表示のものの一覧 */ }
function expand(id, dir) { /* expandable の先頭 20 件を visible に追加して render() */ }

// 5. 詳細パネル
function showDetail(id) {
  // .summary = node.summary ?? '(要約未生成)' を textContent で
  // pre>code に node.code を textContent で入れてから hljs.highlightElement(codeEl)
  // .loc = `${node.file}:${node.startLine}`(external は名前のみ)
  // 「上流を展開 (+N)」「下流を展開 (+N)」ボタン(N = expandable(id, dir).length、0 なら非表示)
}

// 6. cytoscape イベント
// cy.on('tap', 'node', showDetail) / cy.on('dbltap', 'node', 両方向 expand)

// 7. 検索(#search の input イベント)
// name/file の部分一致(大小無視)。第一ヒットが非表示なら target からの経路上のノードを visible に追加
// (nodesById 全走査で経路計算はせず、単純に「ヒットノード + その隣接」を visible に足す)して render 後、
// cy.animate({ center: { eles }, zoom: 1.2 })。ヒットに 'search-hit' クラスを付け黄色枠。

// 8. パスハイライト
// 観測上流端 = internal ノードで inEdges(=呼び出し元側)が空のもの。#banner 横の <select id="entry-select"> に列挙
// (「観測できた範囲の上流端であり真のエントリポイントとは限らない」注記を title と #banner に表示)。
// 選択時: 上流側を全展開 → BFS で entry→target の経路を短い順に最大 20 本列挙(単純パスのみ、
//   visited 管理で循環回避)→ 経路上のエッジに 'on-path' クラス(太線・着色)。
//   callback-passed を含む経路は select のオプション名に ⚠ を付ける。解除オプションで復帰。

// 9. バナー
// meta: `TS ${meta.tsVersion} (${meta.tsSource ?? ''}) / ${meta.tsconfig ?? '既定設定'}`
// limitations の定型文: dynamic-calls → 「静的解析では検出できない呼び出し(イベント・DI 等)があり得ます」
//                     project-references → 「project references 越しの参照は境界ノードになります」
// truncation: 「⚠ ノード上限により打ち切り(上流 N / 下流 M、未探索: frontier 先頭5件)」

// 10. 全展開ボタン(#expand-all): 全ノードを visible にして render
```

- [ ] **Step 2: viewer.css を実装**

レイアウト: `main { display: flex; height: 100vh }`、`#graph { flex: 1 }`、`#detail { width: 420px; overflow-y: auto; border-left: 1px solid }`。ダーク基調(highlight.js の github-dark と揃える)。`#banner` は上部固定バー。詳細は実装者の裁量(頑健性 > 見た目)。

- [ ] **Step 3: 手動確認**

```bash
cd plugins/cc-func-understand/skills/func-understand/scripts
node analyze-callgraph.mjs --project test/fixtures/callback --function itemHandler --out /tmp/g.json
node generate-html.mjs --graph /tmp/g.json --out /tmp/viewer-check.html
open /tmp/viewer-check.html
```

確認項目: グラフが描画される / boot ノードまで見える(展開後)/ callback-passed が破線 / ノードタップで詳細+ハイライトされたコード / 検索で itemHandler にフォーカス / entry-select で boot を選ぶと経路着色 / バナーに TS バージョンと注記。

- [ ] **Step 4: コミット**

```bash
git add plugins/cc-func-understand
git commit -m "feat(cc-func-understand): インタラクティブビューア UI を実装

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Playwright smoke test(4 点)

**Files:**
- Create: `scripts/test/smoke.spec.mjs`
- Create: `scripts/playwright.config.mjs`

**Interfaces:**
- Consumes: Task 8 の DOM 契約(`#graph` canvas、`#detail`、`#search`、`window.__xss_executed` が「実行されない」こと)

- [ ] **Step 1: playwright.config.mjs を作成**

```js
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test', testMatch: 'smoke.spec.mjs', use: { headless: true } });
```

`npx playwright install chromium` を実行(初回のみ)。

- [ ] **Step 2: smoke.spec.mjs を書く**

```js
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
  const g = path.join(dir, 'g.json'); const html = path.join(dir, 'v.html');
  execFileSync('node', [path.join(scripts, 'analyze-callgraph.mjs'), '--project',
    path.join(here, 'fixtures', fixture), '--function', fn, '--out', g]);
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
  const before = await page.evaluate(() => window.__cy.nodes().length); // viewer.js で window.__cy = cy を公開しておく
  await page.click('#expand-all');
  const after = await page.evaluate(() => window.__cy.nodes().length);
  expect(after).toBeGreaterThan(before);
  const bootVisible = await page.evaluate(() => window.__cy.nodes().some((n) => n.data('label')?.includes('boot') || n.data('id').includes('main.ts')));
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
```

※ このテストが要求するグローバル公開(`window.__cy`, `window.__showDetail`, `window.__graphTargetId`)を Task 8 の viewer.js 末尾に追加する(テスト用フックとしてコメントを付ける)。

- [ ] **Step 3: テストを実行し、失敗があれば viewer.js を修正して通す**

Run: `npx playwright test test/smoke.spec.mjs`
Expected: 4 PASS

- [ ] **Step 4: 全テスト回帰確認とコミット**

Run: `node --test test/ && npx playwright test test/smoke.spec.mjs`

```bash
git add plugins/cc-func-understand
git commit -m "test(cc-func-understand): Playwright smoke test を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: SKILL.md・コマンド定義・README・マーケットプレイス登録

**Files:**
- Create: `plugins/cc-func-understand/skills/func-understand/SKILL.md`
- Create: `plugins/cc-func-understand/commands/func-understand.md`
- Create: `plugins/cc-func-understand/README.md`
- Modify: `README.md`(リポジトリルートのプラグイン一覧テーブル)

**Interfaces:**
- Consumes: Task 6 の CLI 契約(exit code / status JSON)、Task 7 の generate-html CLI

- [ ] **Step 1: SKILL.md を書く**

冒頭 frontmatter(cc-html の SKILL.md の形式に合わせる):

```markdown
---
name: func-understand
description: Use when the user invokes /func-understand or asks to visualize a function's call graph, callers/callees, upstream routing path, or dependency chain as an interactive HTML view for a TS/JS codebase.
---
```

本文に含める必須セクション(スペックの「データフロー」を手順化したもの):

1. **前提確認**: 対象は TS/JS プロジェクトのみ。`scripts/` に `node_modules` が無ければ `npm install` を実行(初回のみ)
2. **解析実行**: `node <skill>/scripts/analyze-callgraph.mjs --project <プロジェクトルート> --function <関数名> --out <scratchpad>/graph.json` を実行
   - exit 2 + `status: ambiguous` → candidates を AskUserQuestion で提示(ラベル: `relFile:startLine (containerName)`)→ 選択された候補の `--file` と `--line` を付けて再実行
   - exit 2 + `status: not-found` → suggestions を提示して再入力を促す
   - `truncated: true` → 生成は続行し、完了報告時に `--upstream-depth`/`--downstream-depth` 付き再実行を提案
   - モノレポで上流が境界ノードで切れていると思われる場合は `--tsconfig` の指定を案内
3. **AI 要約**: graph.json を読み、`min(upstreamDistance ?? Infinity, downstreamDistance ?? Infinity) <= 2` の内部ノードそれぞれに 1〜3 行の日本語要約を書き、各ノードの `summary` フィールドに埋めて graph.json を上書き保存。対象が 30 ノード超なら Task tool のサブエージェントに分割(1 体あたり 30 ノード、プロンプトには対象ノードの id/name/code を渡し、`{id: summary}` の JSON を返させる)。**対象範囲外のノードには触れない**
4. **HTML 生成**: `node <skill>/scripts/generate-html.mjs --graph <scratchpad>/graph.json --out <project-root>/docs/func-understand/YYYY-MM-DD-HHMM-<関数名>.html --title "<関数名> の呼び出しグラフ"` → `open` でブラウザ表示 → 絶対パスをユーザーに報告
5. **注意**: HTML を chat に貼らない。エージェントはグラフの正確性に関与しない(スクリプトの出力が正)

- [ ] **Step 2: commands/func-understand.md を書く**

cc-html の `commands/html.md` の形式に合わせ、`/func-understand <関数名>` をスキル起動にマップする(frontmatter の書式は cc-html を読んで踏襲)。引数無し起動時は「どの関数を可視化するか」を AskUserQuestion で確認する旨を記載。

- [ ] **Step 3: README 2 件を書く**

- `plugins/cc-func-understand/README.md`: 概要・使い方(`/func-understand getUser`)・仕組み(4 段階パイプライン図)・既知の制約(動的呼び出し・project references・匿名関数)・必要環境(Node 18+)
- ルート `README.md` のテーブルに 1 行追加: `| [cc-func-understand](./plugins/cc-func-understand/) | /func-understand <関数名> で呼び出しグラフを解析し、自己完結のインタラクティブ HTML として可視化 |`
- `.claude-plugin/marketplace.json` がリポジトリルートに存在する場合はそこにも登録エントリを追加する(cc-html のエントリ形式を踏襲)

- [ ] **Step 4: プラグインとして起動確認**

```bash
claude --plugin-dir ./plugins/cc-func-understand
# 別セッションで /func-understand が補完に出ること、SKILL.md が認識されることを確認
```

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand README.md
git commit -m "feat(cc-func-understand): SKILL.md・コマンド定義・README を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 実プロジェクト通し検証

**Files:** なし(検証のみ。発見した不具合は該当タスクのファイルを修正)

- [ ] **Step 1: 検証対象の実プロジェクトをユーザーに確認**

AskUserQuestion で「どの TS プロジェクトで通し検証するか」を確認する(Express 等のコールバック登録型ルーティングを含むものが望ましい)。手元に無ければ `npx create-next-app` 等で小規模プロジェクトを scratchpad に作る選択肢も提示。

- [ ] **Step 2: `/func-understand` を通しで実行**

`claude --plugin-dir ./plugins/cc-func-understand` のセッションで実プロジェクトの関数を指定し、次を確認:

- 解析が 30 秒以内に完了する(超える場合は所要時間を記録し報告)
- 曖昧候補フローが AskUserQuestion で機能する
- HTML がブラウザで開き、上流がルーティング層(または callback-passed 経由の登録元)まで見える
- 要約が距離 2 以内に付いている
- バナーの注記・truncation 表示が正しい

- [ ] **Step 3: 発見した問題の修正とコミット、結果報告**

問題があれば該当モジュールのテストを追加してから修正(TDD)。最後に検証結果(スクリーンショット代わりに確認項目の結果一覧)をユーザーに報告し、superpowers:finishing-a-development-branch でブランチの扱い(PR 作成等)を確認する。

---

## Self-Review 記録

- **Spec coverage**: 決定事項サマリー全 11 項目 → Task 1(TS固定)/ 2(既定options・membership)/ 3(曖昧性・匿名)/ 4(BFS交互・方向別distance・16KB・境界・truncation)/ 5(参照エッジ・上流継続)/ 6(CLI引数・meta/limitations)/ 7(インライン・エスケープ)/ 8(±1ホップ・上限20・展開分離・検索・パス上限20・観測上流端・バナー)/ 9(smoke 4点)/ 10(SKILL手順・要約距離2・サブエージェント分担)/ 11(実プロジェクト検証)で全カバー
- **未カバーの明示**: module ノードの excerpt(±10行)は Task 4 の itemToNode 内で実装(コメントに記載済み)。fixture truncation はディレクトリを作らず basic + `--max-nodes 2` で代替(スペックのテスト8種のうち「truncation」に対応)
- **Type consistency**: `loadTypeScript`→`{ts,source,version}`、`loadProject`→`{service,program,fileNames,tsconfigPath,isInternal}`、`resolveTarget`→`ResolveResult`、`buildGraph`→`Graph`、エッジ `{from,to,kind,callLines}` を全タスクで統一済み。Playwright が使う `window.__cy`/`__showDetail`/`__graphTargetId` は Task 8 Step1 と Task 9 Step2 の双方に記載済み
