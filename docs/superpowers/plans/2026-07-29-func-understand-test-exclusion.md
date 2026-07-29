# func-understand テスト関連ファイル除外 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テスト関連ファイルをコールグラフからデフォルトで除外する。除外パターンはリポごとの定義ファイル `.func-understand.json` に持ち、`--include-tests` で無効化できる。

**Architecture:** 新モジュール `lib/test-file-matcher.mjs`(glob→正規表現、定義ファイル読み込み、除外判定関数の生成)を追加し、`graph-builder.mjs` の `stepDirection` と `callback-edges.mjs` の参照走査に除外チェックを差し込む。定義ファイルの「生成」は AI(SKILL.md の手順)、「適用」はスクリプト、という責務分担。スペック: `docs/superpowers/specs/2026-07-29-func-understand-test-exclusion-design.md`

**Tech Stack:** Node.js 18+(ESM / `node:test`)、TypeScript Compiler API(既存)。**新規 npm 依存の追加は禁止**(glob マッチングは自前実装)。

## Global Constraints

- 作業ディレクトリ: `plugins/cc-func-understand/skills/func-understand/scripts/`(以下、パスはすべてここからの相対。`docs/` と `.claude-plugin/` はリポルートからの相対)
- 単体テストの実行: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`(`node --test "test/*.test.mjs"`)
- glob サポート構文は `**` / `*` / `?` / `{a,b}` のみ。パターンは projectRoot からの相対パス(posix 区切り)**全体**にアンカーしてマッチ
- 除外チェックは maxNodes チェック・`truncation.frontier` 計上より**前**に置く(stdlib 除外と同じ理由: 除外対象が「上限で打ち切られた」という誤案内を生まないため)
- コメント・エラーメッセージ・テスト名は既存コードにならい日本語
- コミットメッセージは既存の慣習に従い `feat(cc-func-understand): ...` 形式 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: glob マッチャー(`globToRegExp` / `createMatcher`)

**Files:**
- Create: `lib/test-file-matcher.mjs`
- Test: `test/test-file-matcher.test.mjs`

**Interfaces:**
- Consumes: なし(依存ゼロの純関数)
- Produces:
  - `globToRegExp(glob: string): RegExp` — サポート構文の glob を `^...$` アンカー付き RegExp に変換
  - `createMatcher(globs: string[]): (relPath: string) => boolean` — いずれかのパターンにマッチするか。入力パスは `\` → `/` 正規化・先頭 `./` 除去してから判定

- [ ] **Step 1: 失敗するテストを書く**

`test/test-file-matcher.test.mjs` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, createMatcher } from '../lib/test-file-matcher.mjs';

test('globToRegExp: * はセグメント内のみにマッチする', () => {
  assert.ok(globToRegExp('*.ts').test('a.ts'));
  assert.ok(!globToRegExp('*.ts').test('src/a.ts'));
});

test('globToRegExp: **/ は 0 個以上のセグメントにマッチする', () => {
  const re = globToRegExp('**/*.test.*');
  assert.ok(re.test('foo.test.ts'));
  assert.ok(re.test('src/a/foo.test.tsx'));
  assert.ok(!re.test('latest.ts'));
  assert.ok(!re.test('src/latest.ts'));
});

test('globToRegExp: ディレクトリセグメントは完全一致(部分文字列に誤爆しない)', () => {
  const re = globToRegExp('**/test/**');
  assert.ok(re.test('test/helper.ts'));
  assert.ok(re.test('src/test/x.ts'));
  assert.ok(re.test('src/test/deep/x.ts'));
  assert.ok(!re.test('testing/x.ts'));
  assert.ok(!re.test('abtest/x.ts'));
  assert.ok(!re.test('test'), 'test という名前のファイル自体にはマッチしない');
});

test('globToRegExp: 末尾以外の ** と先頭固定パターン', () => {
  const re = globToRegExp('e2e/**');
  assert.ok(re.test('e2e/login.spec.ts'));
  assert.ok(re.test('e2e/deep/x.ts'));
  assert.ok(!re.test('src/e2e/x.ts'), '先頭固定なので任意階層にはマッチしない');
});

test('globToRegExp: {a,b} と ? をサポートする', () => {
  const re = globToRegExp('**/*.{test,spec}.ts');
  assert.ok(re.test('a.test.ts'));
  assert.ok(re.test('src/a.spec.ts'));
  assert.ok(!re.test('a.bench.ts'));
  assert.ok(globToRegExp('a?.ts').test('ab.ts'));
  assert.ok(!globToRegExp('a?.ts').test('a.ts'), '? は 1 文字必須');
});

test('globToRegExp: 正規表現特殊文字はリテラル扱い', () => {
  assert.ok(!globToRegExp('a.b').test('axb'));
  assert.ok(globToRegExp('a.b').test('a.b'));
  assert.ok(globToRegExp('a+b/*.ts').test('a+b/x.ts'));
});

test('createMatcher: 複数パターンのいずれかにマッチし、パス区切りを正規化する', () => {
  const m = createMatcher(['**/*.test.*', '**/__tests__/**']);
  assert.ok(m('__tests__/foo.ts'));
  assert.ok(m('src\\a\\foo.test.ts'), 'Windows 区切りでも判定できる');
  assert.ok(m('./src/a/foo.test.ts'), '先頭 ./ を無視する');
  assert.ok(!m('src/a/foo.ts'));
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/test-file-matcher.test.mjs`
Expected: FAIL(`Cannot find module '../lib/test-file-matcher.mjs'`)

- [ ] **Step 3: 実装する**

`lib/test-file-matcher.mjs` を新規作成:

```js
/**
 * テスト関連ファイルの除外判定(スペック:
 * docs/superpowers/specs/2026-07-29-func-understand-test-exclusion-design.md)。
 *
 * glob のサポート構文は `**` / `*` / `?` / `{a,b}` のみ(SKILL.md に明記)。
 * パターンは projectRoot からの相対パス(posix 区切り)全体にアンカーしてマッチする。
 * npm の glob 実装は使わない(スクリプトのランタイム依存ゼロ維持)。
 */

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g;

/** 1 セグメント分の glob(`**` 以外)を正規表現文字列へ変換する */
function segmentToRegExp(seg) {
  return seg
    .replace(REGEX_SPECIALS, '\\$&')
    .replace(/\{([^}]*)\}/g, (_, body) => `(?:${body.split(',').join('|')})`)
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');
}

export function globToRegExp(glob) {
  const segments = glob.split('/');
  const parts = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (seg === '**') {
      // 末尾の `dir/**` は「配下の 1 個以上のセグメント」、それ以外の `**/` は
      // 「0 個以上のセグメント」(`**/test/**` が `test/helper.ts` にもマッチするように)
      parts.push(isLast ? '(?:[^/]+/)*[^/]+' : '(?:[^/]+/)*');
      continue;
    }
    parts.push(segmentToRegExp(seg) + (isLast ? '' : '/'));
  }
  return new RegExp(`^${parts.join('')}$`);
}

export function createMatcher(globs) {
  const regexps = globs.map(globToRegExp);
  return (relPath) => {
    const p = relPath.replaceAll('\\', '/').replace(/^\.\//, '');
    return regexps.some((r) => r.test(p));
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test test/test-file-matcher.test.mjs`
Expected: PASS(全 7 テスト)

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/test-file-matcher.mjs plugins/cc-func-understand/skills/func-understand/scripts/test/test-file-matcher.test.mjs
git commit -m "feat(cc-func-understand): glob マッチャーを追加(テスト除外の基盤)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 定義ファイル読み込みと除外判定関数(`loadTestExclusions` / `createFileExcluder`)

**Files:**
- Modify: `lib/test-file-matcher.mjs`(Task 1 で作成したファイルに追記)
- Test: `test/test-file-matcher.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 1 の `createMatcher(globs)`
- Produces:
  - `loadTestExclusions(configPath: string): { globs: string[] | null, warning?: string }` — 定義ファイルを読む。ファイル無し → `{ globs: null }`、JSON パース失敗 → `{ globs: null, warning }`、`testExclude` が文字列配列でない → `{ globs: null }`、正常 → `{ globs }`
  - `createFileExcluder(projectRoot: string, globs: string[]): (absPath: string) => boolean` — 絶対パスを受け、projectRoot 相対に変換してマッチ判定。projectRoot 外(相対が `..` 始まり)と projectRoot 自身は常に false

- [ ] **Step 1: 失敗するテストを書く**

`test/test-file-matcher.test.mjs` に追記(import に `fs` / `os` / `path` と新関数を追加):

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, createMatcher, loadTestExclusions, createFileExcluder } from '../lib/test-file-matcher.mjs';

const tmpConfig = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-matcher-'));
  const p = path.join(dir, '.func-understand.json');
  if (content != null) fs.writeFileSync(p, content);
  return p;
};

test('loadTestExclusions: ファイルが無ければ globs null(警告なし)', () => {
  const r = loadTestExclusions(tmpConfig(null));
  assert.equal(r.globs, null);
  assert.equal(r.warning, undefined);
});

test('loadTestExclusions: 不正 JSON は warning 付きで globs null', () => {
  const r = loadTestExclusions(tmpConfig('{ oops'));
  assert.equal(r.globs, null);
  assert.match(r.warning, /不正な JSON/);
});

test('loadTestExclusions: testExclude が文字列配列でなければ globs null', () => {
  assert.equal(loadTestExclusions(tmpConfig('{}')).globs, null);
  assert.equal(loadTestExclusions(tmpConfig('{"testExclude": "x"}')).globs, null);
  assert.equal(loadTestExclusions(tmpConfig('{"testExclude": [1]}')).globs, null);
});

test('loadTestExclusions: 正常系', () => {
  const r = loadTestExclusions(tmpConfig('{"testExclude": ["**/*.test.*"]}'));
  assert.deepEqual(r.globs, ['**/*.test.*']);
});

test('createFileExcluder: projectRoot 相対で判定し、外側は除外しない', () => {
  const ex = createFileExcluder('/p', ['**/*.test.*']);
  assert.ok(ex('/p/src/a.test.ts'));
  assert.ok(!ex('/p/src/a.ts'));
  assert.ok(!ex('/outside/a.test.ts'), 'projectRoot 外は対象にしない');
  assert.ok(!ex('/p'), 'projectRoot 自身は対象にしない');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test test/test-file-matcher.test.mjs`
Expected: FAIL(`loadTestExclusions` / `createFileExcluder` が export されていない)

- [ ] **Step 3: 実装する**

`lib/test-file-matcher.mjs` の先頭に import を追加し、末尾に追記:

```js
import fs from 'node:fs';
import path from 'node:path';
```

```js
/**
 * `.func-understand.json` から testExclude 配列を読み込む。
 * 「除外なし」への劣化は安全側(ノードが余計に出るだけ)なので、
 * ファイル無し・キー無し・型不一致は警告なしで null を返し、
 * 不正 JSON のみ warning を返す(ユーザーの編集ミスに気付けるように)。
 */
export function loadTestExclusions(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return { globs: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { globs: null, warning: `${configPath} が不正な JSON のため、テスト除外なしで解析します` };
  }
  const globs = parsed?.testExclude;
  if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string')) {
    return { globs: null };
  }
  return { globs };
}

export function createFileExcluder(projectRoot, globs) {
  const matcher = createMatcher(globs);
  return (absPath) => {
    const rel = path.relative(projectRoot, absPath).replaceAll('\\', '/');
    if (rel === '' || rel.startsWith('..')) return false; // projectRoot 外・自身は対象にしない
    return matcher(rel);
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test test/test-file-matcher.test.mjs`
Expected: PASS(全 12 テスト)

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/test-file-matcher.mjs plugins/cc-func-understand/skills/func-understand/scripts/test/test-file-matcher.test.mjs
git commit -m "feat(cc-func-understand): 除外定義ファイルの読み込みと除外判定関数を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: fixture 新設と `stepDirection` の除外

**Files:**
- Create: `test/fixtures/test-exclusion/tsconfig.json`
- Create: `test/fixtures/test-exclusion/.func-understand.json`
- Create: `test/fixtures/test-exclusion/src/core.ts`
- Create: `test/fixtures/test-exclusion/src/log.ts`
- Create: `test/fixtures/test-exclusion/src/runner.ts`
- Create: `test/fixtures/test-exclusion/__tests__/core.test.ts`
- Create: `test/fixtures/test-exclusion/test/helper.ts`
- Modify: `lib/graph-builder.mjs`(`createGraphContext` と `stepDirection`)
- Test: `test/graph-builder.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 2 の `createFileExcluder(projectRoot, globs)`
- Produces:
  - `buildGraph` の opts に `isFileExcluded?: (absPath: string) => boolean` を追加(デフォルト `() => false`)。ctx に `isFileExcluded` として保持され、Task 4 の `addCallbackEdges` が `graph._ctx.isFileExcluded` で参照する
  - fixture `test-exclusion`: 起点 `createWidget`(src/core.ts)。本番上流 `useWidget`、内部下流 `logCreation`、テスト上流 `callInTest`(__tests__/)・`helperCall`(test/)・`anotherTestCaller`(__tests__/、useWidget 経由の距離 2)、コールバック渡し `passesFactory`(test/、`runFactory(createWidget)`)

- [ ] **Step 1: fixture を作成する**

`test/fixtures/test-exclusion/tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" }, "include": ["src", "test", "__tests__"] }
```

`test/fixtures/test-exclusion/.func-understand.json`:

```json
{
  "testExclude": ["**/*.test.*", "**/__tests__/**", "**/test/**"]
}
```

`test/fixtures/test-exclusion/src/core.ts`:

```ts
import { logCreation } from './log';

export function createWidget(name: string) {
  logCreation(name);
  return { name };
}

export function useWidget() {
  return createWidget('main');
}
```

`test/fixtures/test-exclusion/src/log.ts`:

```ts
export function logCreation(name: string) {
  return `created: ${name}`;
}
```

`test/fixtures/test-exclusion/src/runner.ts`:

```ts
export function runFactory(factory: (name: string) => { name: string }) {
  return factory('run');
}
```

`test/fixtures/test-exclusion/__tests__/core.test.ts`:

```ts
import { createWidget, useWidget } from '../src/core';
import { helperCall } from '../test/helper';

export function callInTest() {
  helperCall();
  return createWidget('from-test');
}

export function anotherTestCaller() {
  return useWidget();
}
```

`test/fixtures/test-exclusion/test/helper.ts`:

```ts
import { createWidget } from '../src/core';
import { runFactory } from '../src/runner';

export function helperCall() {
  return createWidget('from-helper');
}

export function passesFactory() {
  return runFactory(createWidget);
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/graph-builder.test.mjs` に追記(import に `createFileExcluder` を追加):

```js
import { createFileExcluder } from '../lib/test-file-matcher.mjs';
```

```js
test('test-exclusion: テストファイル由来のノード/エッジが作られず truncation も汚れない', () => {
  const projectRoot = path.join(here, 'fixtures', 'test-exclusion');
  const isFileExcluded = createFileExcluder(projectRoot, ['**/*.test.*', '**/__tests__/**', '**/test/**']);
  // テストファイルが maxNodes 予算や frontier を汚すと truncation が発生するよう、
  // 本番ノード数ちょうど(createWidget, useWidget, logCreation)+1 の余裕に絞る
  const g = graphFor('test-exclusion', 'createWidget', { maxNodes: 4, isFileExcluded });
  assert.ok(byName(g, 'useWidget'), '本番上流は残る');
  assert.ok(byName(g, 'logCreation'), '内部下流は残る');
  assert.equal(byName(g, 'callInTest'), undefined);
  assert.equal(byName(g, 'helperCall'), undefined);
  assert.equal(byName(g, 'anotherTestCaller'), undefined, '距離 2 のテスト上流も出ない');
  assert.ok(g.nodes.every((n) => !n.file || (!n.file.startsWith('__tests__/') && !n.file.startsWith('test/'))));
  assert.equal(g.truncation, null, 'テストファイルが maxNodes 予算や truncation.frontier を汚さない');
});

test('test-exclusion: isFileExcluded 未指定なら従来どおり全ノードが出る', () => {
  const g = graphFor('test-exclusion', 'createWidget');
  assert.ok(byName(g, 'callInTest'));
  assert.ok(byName(g, 'helperCall'));
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `node --test test/graph-builder.test.mjs`
Expected: 1 つ目の新テストが FAIL(`callInTest` / `helperCall` がノードに存在する)。2 つ目(対照)は PASS

- [ ] **Step 4: `graph-builder.mjs` に除外を実装する**

`createGraphContext` の分割代入に `isFileExcluded` を追加:

```js
const { projectRoot, maxNodes = 300, upstreamDepth = Infinity, downstreamDepth = Infinity, isFileExcluded = () => false } = opts;
```

`createGraphContext` の return オブジェクトに `isFileExcluded,` を追加(`upsertEdge,` の次の行など)。

`stepDirection` の stdlib チェックの直後・maxNodes チェックの前に追加:

```js
    if (!proj.isInternal(peerItem.file) && classifySymbolFile(proj.program, peerItem.file) === 'stdlib') continue;
    // テスト関連ファイルはノード化しない。stdlib と同じく maxNodes チェックより前に
    // 弾くことで、テストファイルが予算を消費したり truncation.frontier を汚したりしない
    // (誤った「打ち切られた」案内を防ぐ)。
    if (ctx.isFileExcluded(peerItem.file)) continue;
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test test/graph-builder.test.mjs`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/test/fixtures/test-exclusion plugins/cc-func-understand/skills/func-understand/scripts/lib/graph-builder.mjs plugins/cc-func-understand/skills/func-understand/scripts/test/graph-builder.test.mjs
git commit -m "feat(cc-func-understand): stepDirection でテストファイルをグラフから除外

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `addCallbackEdges` の参照経路にも除外を適用

**Files:**
- Modify: `lib/callback-edges.mjs`
- Test: `test/callback-edges.test.mjs`(追記)

**Interfaces:**
- Consumes: Task 3 の `ctx.isFileExcluded`(`graph._ctx` 経由。`buildGraph` に `isFileExcluded` を渡さなかった場合は常に false のデフォルトが入っている)
- Produces: なし(挙動変更のみ)

- [ ] **Step 1: 失敗するテストを書く**

`test/callback-edges.test.mjs` に追記。既存の import 群(`loadTypeScript` / `loadProject` / `resolveTarget` / `buildGraph` / `addCallbackEdges` / `path` / `fileURLToPath` — 無いものだけ追加)と `createFileExcluder` を使う:

```js
import { createFileExcluder } from '../lib/test-file-matcher.mjs';
```

```js
test('test-exclusion: テストファイルからの callback-passed 参照はノード化されない', () => {
  const projectRoot = path.join(here, 'fixtures', 'test-exclusion');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: 'createWidget' }, projectRoot);
  assert.equal(r.status, 'resolved');
  const isFileExcluded = createFileExcluder(projectRoot, ['**/*.test.*', '**/__tests__/**', '**/test/**']);
  let g = buildGraph(ts, proj, r.declaration, { projectRoot, isFileExcluded });
  g = addCallbackEdges(ts, proj, g, { projectRoot });
  assert.ok(!g.nodes.some((n) => n.name === 'passesFactory'), 'test/ 内の参照元関数がノード化されない');
  assert.ok(!g.edges.some((e) => e.kind === 'callback-passed'));
});

test('test-exclusion: 除外なしなら callback-passed が検出される(対照)', () => {
  const projectRoot = path.join(here, 'fixtures', 'test-exclusion');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: 'createWidget' }, projectRoot);
  assert.equal(r.status, 'resolved');
  let g = buildGraph(ts, proj, r.declaration, { projectRoot });
  g = addCallbackEdges(ts, proj, g, { projectRoot });
  assert.ok(g.nodes.some((n) => n.name === 'passesFactory'));
  assert.ok(g.edges.some((e) => e.kind === 'callback-passed'));
});
```

(`here` / `ts` の初期化が既存ファイルに無い場合は graph-builder.test.mjs と同じ形で追加する)

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test test/callback-edges.test.mjs`
Expected: 1 つ目が FAIL(`passesFactory` がノード化される)。2 つ目(対照)は PASS

- [ ] **Step 3: `callback-edges.mjs` に除外を実装する**

`addCallbackEdges` 内、`const refSf = proj.program.getSourceFile(ref.fileName); if (!refSf) continue;` の直後に追加:

```js
        // テスト関連ファイル内の参照はノード化しない(findReferences 経路は stepDirection の
        // 除外を通らないため、ここでも同じマッチャーで弾く)。frontier 計上より前に skip する。
        if (ctx.isFileExcluded(ref.fileName)) continue;
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test test/callback-edges.test.mjs`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/callback-edges.mjs plugins/cc-func-understand/skills/func-understand/scripts/test/callback-edges.test.mjs
git commit -m "feat(cc-func-understand): callback-passed 参照経路にもテスト除外を適用

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: CLI 配線(自動読み込み / `--include-tests` / `--test-exclude` / 起点判定)

**Files:**
- Modify: `analyze-callgraph.mjs`
- Test: `test/cli.test.mjs`(`run()` ヘルパーの置き換え + テスト追記)

**Interfaces:**
- Consumes: Task 2 の `loadTestExclusions` / `createFileExcluder`、Task 3 の `buildOpts.isFileExcluded`
- Produces: CLI フラグ `--include-tests`(boolean)/ `--test-exclude <path>`(string)。デフォルトで `<projectRoot>/.func-understand.json` を自動読み込み。起点がテストファイルなら stderr に `起点がテストファイルのため、テスト除外を無効化して解析します` を出して除外無効化。`--test-exclude` の明示パスが存在しなければ exit 1

- [ ] **Step 1: `run()` ヘルパーを stderr も返す形に置き換える**

`test/cli.test.mjs` の import の `execFileSync` を `spawnSync` に変え、`run()` を置き換える(spawnSync は非ゼロ exit でも throw しないため、成功時にも stderr を検証できる。既存テストは `code` / `stdout` / `stderr` のみ参照しており互換):

```js
import { spawnSync } from 'node:child_process';

function run(args) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
```

Run: `node --test test/cli.test.mjs`
Expected: PASS(既存全件。置き換えだけで挙動が変わらないことの確認)

- [ ] **Step 2: 失敗するテストを書く**

`test/cli.test.mjs` に追記:

```js
test('test-exclusion: .func-understand.json を自動読み込みしてテストを除外する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const names = g.nodes.map((n) => n.name);
  assert.ok(!names.some((n) => ['callInTest', 'helperCall', 'anotherTestCaller', 'passesFactory'].includes(n)));
  assert.ok(names.includes('useWidget'));
});

test('test-exclusion: --include-tests で定義ファイルを読まず全ノードが出る', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--include-tests', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const names = g.nodes.map((n) => n.name);
  assert.ok(names.includes('callInTest'));
  assert.ok(names.includes('passesFactory'), 'callback-passed 経路も復元される');
});

test('test-exclusion: 起点がテストファイル内なら除外を無効化する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'callInTest', '--out', out]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /起点がテストファイル/);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.nodes.some((n) => n.name === 'helperCall'), '除外が無効化されテスト内の下流も出る');
});

test('test-exclusion: --test-exclude の明示パスが存在しなければ exit 1', () => {
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--test-exclude', path.join(here, 'fixtures/nonexistent.json'), '--out', tmp()]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--test-exclude/);
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `node --test test/cli.test.mjs`
Expected: 新規 4 テストが FAIL(自動読み込み・フラグが未実装のため。`--include-tests` は parseArgs が unknown option エラーにする)

- [ ] **Step 4: `analyze-callgraph.mjs` に実装する**

import に追加:

```js
import { loadTestExclusions, createFileExcluder } from './lib/test-file-matcher.mjs';
```

`parseCliArgs` の options に追加:

```js
      'include-tests': { type: 'boolean' },
      'test-exclude': { type: 'string' },
```

`main` 内、`resolveTarget` の分岐(exit 2 の 2 分岐)の後・`buildOpts` 組み立ての前に追加:

```js
  // テスト除外(スペック: docs/superpowers/specs/2026-07-29-func-understand-test-exclusion-design.md)
  // デフォルトで <projectRoot>/.func-understand.json を読む。--include-tests は定義ファイル自体を読まない。
  let isFileExcluded = null;
  if (!args['include-tests']) {
    const explicitPath = args['test-exclude'];
    const configPath = explicitPath ? path.resolve(explicitPath) : path.join(projectRoot, '.func-understand.json');
    if (explicitPath && !fs.existsSync(configPath)) {
      throw new Error(`--test-exclude で指定されたファイルが見つかりません: ${configPath}`);
    }
    const { globs, warning } = loadTestExclusions(configPath);
    if (warning) console.error(warning);
    if (globs && globs.length > 0) isFileExcluded = createFileExcluder(projectRoot, globs);
  }
  if (isFileExcluded && isFileExcluded(resolution.declaration.file)) {
    console.error('起点がテストファイルのため、テスト除外を無効化して解析します');
    isFileExcluded = null;
  }
```

`buildOpts` 組み立て部分に 1 行追加:

```js
  if (isFileExcluded) buildOpts.isFileExcluded = isFileExcluded;
```

(`addCallbackEdges` は `graph._ctx.isFileExcluded` を参照するため変更不要)

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test test/cli.test.mjs`
Expected: PASS(既存 + 新規全件)

- [ ] **Step 6: 全単体テストを回す**

Run: `npm test`
Expected: PASS(全ファイル。既存 39 件 + 本計画の追加分)

- [ ] **Step 7: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/analyze-callgraph.mjs plugins/cc-func-understand/skills/func-understand/scripts/test/cli.test.mjs
git commit -m "feat(cc-func-understand): CLI にテスト除外の自動読み込みと --include-tests/--test-exclude を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ドキュメント更新とバージョン(SKILL.md / README / plugin.json / marketplace.json)

**Files:**
- Modify: `plugins/cc-func-understand/skills/func-understand/SKILL.md`
- Modify: `plugins/cc-func-understand/README.md`
- Modify: `plugins/cc-func-understand/.claude-plugin/plugin.json`(version → `0.3.0`)
- Modify: `.claude-plugin/marketplace.json`(cc-func-understand の version → `0.3.0`)

**Interfaces:**
- Consumes: Task 5 の CLI フラグ仕様
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: SKILL.md を更新する**

(1) 冒頭の「パイプラインは 4 段階」を 5 段階に変更:

```markdown
パイプラインは 5 段階:

1. 前提確認
2. テスト除外定義の確認・生成
3. 解析実行(`analyze-callgraph.mjs`)
4. AI 要約(グラフ JSON に summary を埋める)
5. HTML 生成(`generate-html.mjs`)
```

(2) 既存セクション見出しを繰り下げる: `## 2. 解析実行` → `## 3. 解析実行`、`## 3. AI 要約` → `## 4. AI 要約`、`## 4. HTML 生成` → `## 5. HTML 生成`、`## 5. 注意` → `## 6. 注意`。

(3) `## 1. 前提確認` の直後に新セクションを挿入:

````markdown
## 2. テスト除外定義の確認・生成

テスト関連ファイル(`*.test.ts` / `__tests__/` など)はデフォルトでグラフから除外される。除外パターンは解析対象リポごとの定義ファイル `<project-root>/.func-understand.json` が持つ。

- ユーザーが「テスト込みで」等と明示した場合: このセクションをスキップし、解析実行時に `--include-tests` を付与する。
- `<project-root>/.func-understand.json` が既に存在する場合: そのまま使う(内容の確認・再生成はしない)。
- 存在しない場合(初回のみ)、以下の手順で生成する:
  1. リポのテスト設定を調査する: `jest.config.*` / `vitest.config.*` / `playwright.config.*` / `cypress.config.*` / `package.json`(`test` スクリプト・`jest` フィールド)/ tsconfig の `exclude` など。
  2. 見つかった testMatch / include / specPattern をサポート構文の glob に転記して `testExclude` 配列を作る。**サポート構文は `**` / `*` / `?` / `{a,b}` のみ**で、パターンは projectRoot からの相対パス(posix 区切り)全体にマッチする。extglob(`?(*.)` / `@(spec|test)` 等)はサポート構文の組み合わせに展開する(例: jest デフォルトの `**/?(*.)+(spec|test).[jt]s?(x)` → `["**/*.test.*", "**/*.spec.*", "**/test.*", "**/spec.*"]`)。
  3. テスト設定が見つからなければ、次のフォールバック既定セットをそのまま書き込む:

     ```json
     {
       "testExclude": [
         "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/*-test.*",
         "**/*.cy.*", "**/*.e2e-spec.*",
         "**/__tests__/**", "**/__mocks__/**", "**/__snapshots__/**",
         "**/__fixtures__/**", "**/__helpers__/**",
         "**/test/**", "**/tests/**", "**/spec/**", "**/e2e/**", "**/cypress/**"
       ]
     }
     ```

  4. 対象が git リポなら `.git/info/exclude` の末尾に `.func-understand.json` の行を追記する(既に記載があれば何もしない)。この定義ファイルはローカル生成物でありコミットしない前提(共有したいユーザーは各自 exclude から外せばよい)。
- 対象リポへの書き込みが不適切な場合(読み取り専用・第三者リポ等)は、scratchpad に定義ファイルを生成し、解析実行時に `--test-exclude <そのパス>` を付与する。
- 作り直したい場合(テスト設定が変わった等)は、定義ファイルを削除して再実行するか、ユーザーの指示に従って再生成する。
- 起点関数がテストファイル内にある場合はスクリプトが自動で除外を無効化する(stderr にその旨が出る)。この場合は最終報告で「起点がテストファイルのため除外は適用されていない」ことに触れる。
````

注意: 上記ブロック内の `**` の強調(`**サポート構文は...**`)が glob の `**` と紛らわしい場合は強調を外して構わない。

(4) 繰り下げ後の「3. 解析実行」のフラグ列挙(`必要に応じて ...`)に `--include-tests` `--test-exclude <path>` を追記する。

(5) 繰り下げ後の「6. 注意」の既知の制約リストに追記:

```markdown
  - テスト関連ファイル(`.func-understand.json` の `testExclude` にマッチするファイル)はデフォルトでノード化されない。テスト込みで見たい場合は `--include-tests` を付ける。起点がテストファイル内の場合は自動で除外が無効化される。
```

- [ ] **Step 2: README を更新する**

`plugins/cc-func-understand/README.md` の「既知の制約」リスト(標準ライブラリの項目の直後)に追記:

```markdown
- **テスト関連ファイルはデフォルトで除外される**: 初回実行時に対象リポのテスト設定(jest / vitest / Playwright 等)から除外パターンを推定し、`<project-root>/.func-understand.json` に保存する(git 追跡外・ローカル生成物)。以降はこの定義に従い `*.test.ts` や `__tests__/` などがグラフから除外される。テスト込みで解析したい場合は `--include-tests`、パターンを調整したい場合は `.func-understand.json` の `testExclude` を編集する。起点関数がテストファイル内にある場合は除外が自動で無効化される。
```

- [ ] **Step 3: バージョンを上げる**

- `plugins/cc-func-understand/.claude-plugin/plugin.json` の `"version": "0.2.0"` → `"0.3.0"`
- `.claude-plugin/marketplace.json` 内の cc-func-understand の `"version": "0.2.0"` → `"0.3.0"`

- [ ] **Step 4: 全テスト + smoke を回す**

```bash
cd plugins/cc-func-understand/skills/func-understand/scripts
npm test
npx playwright install chromium --with-deps 2>/dev/null || true  # 未導入の場合のみ
npm run test:smoke
```

Expected: 単体テスト全件 PASS、Playwright smoke 4 件 PASS

- [ ] **Step 5: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/SKILL.md plugins/cc-func-understand/README.md plugins/cc-func-understand/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "docs(cc-func-understand): テスト除外の手順と既知の制約を追記、v0.3.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
