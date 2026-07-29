# func-understand not-a-function ステータス Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--function` に関数以外の名前付き宣言(変数・クラス・enum・interface・type)を指定したとき、`not-found` ではなく `status: "not-a-function"` を kind・場所付きで返し、typo と誤解させない(issue #8)。

**Architecture:** `lib/target-resolver.mjs` に指定名一致の非関数宣言だけを走査する `collectNonFunctionDeclarations` を新設し、`resolveTarget` の not-found 経路でのみ呼ぶフォールバック方式。既存の `collectDeclarations`(graph-builder / callback-edges が「関数系宣言のみ」の前提で共用)は無変更。CLI は新ステータスの出力分岐を追加するだけ(exit 2)。

**Tech Stack:** Node.js(ESM)、TypeScript Compiler API、`node --test`。依存ゼロ維持。

**Spec:** `docs/superpowers/specs/2026-07-29-func-understand-not-a-function-design.md`

## Global Constraints

- 作業ブランチ: `fix/func-understand-not-a-function`(作成済み)
- 作業ディレクトリ(テスト実行): `plugins/cc-func-understand/skills/func-understand/scripts/`
- 新ステータス名は `not-a-function`、exit code は他の解決失敗と同じ `2`
- kind の値は `variable` / `class` / `enum` / `interface` / `type` の5種のみ
- PropertyAssignment(非関数)・getter/setter は対象外
- `collectDeclarations` のシグネチャ・収集対象・既存の ambiguous / not-found / ok の挙動は変えない
- コミットメッセージは `fix(cc-func-understand): ...` 形式、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- コメント・テスト名は既存コードに合わせ日本語

---

### Task 1: target-resolver に not-a-function フォールバックを追加

**Files:**
- Create: `plugins/cc-func-understand/skills/func-understand/scripts/test/fixtures/not-a-function/tsconfig.json`
- Create: `plugins/cc-func-understand/skills/func-understand/scripts/test/fixtures/not-a-function/src/config.ts`
- Modify: `plugins/cc-func-understand/skills/func-understand/scripts/lib/target-resolver.mjs`
- Test: `plugins/cc-func-understand/skills/func-understand/scripts/test/target-resolver.test.mjs`

**Interfaces:**
- Consumes: 既存の `resolveTarget(ts, proj, { functionName, file, line }, projectRoot)` と `collectDeclarations(ts, proj)`(無変更)
- Produces: `resolveTarget` の新しい戻り値バリアント `{ status: 'not-a-function', matches, suggestions }`。`matches` の各要素は `{ file, relFile, kind, startLine, signature }`(`kind` は `variable`/`class`/`enum`/`interface`/`type`、`relFile` は projectRoot 相対、`signature` は宣言行の先頭 120 文字)。`suggestions` は既存 not-found と同形式(部分一致の関数 decl 配列)。新関数 `collectNonFunctionDeclarations(ts, proj, name)` もエクスポートする(Task 2 では使わないが単体テスト可能にするため)。

- [ ] **Step 1: fixture を作成する**

`test/fixtures/not-a-function/tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" }, "include": ["src"] }
```

`test/fixtures/not-a-function/src/config.ts`:

```ts
export const API_CONFIG = { baseUrl: "https://example.com" };
export const MAX_RETRIES = 3;
export const config = { retries: 3 };
export let counter;
export class WidgetStore {
  load(): string {
    return "loaded";
  }
}
export enum Color {
  Red,
  Green,
}
export interface Widget {
  id: string;
}
export type WidgetId = string;

export function loadConfig(): typeof API_CONFIG {
  return API_CONFIG;
}

export const applyConfig = (): number => {
  loadConfig();
  return MAX_RETRIES;
};
```

意図: `API_CONFIG`(オブジェクト定数)・`MAX_RETRIES`(プリミティブ定数)・`config`(小文字のオブジェクト定数。suggestions テストで指定する名前)・`counter`(初期化子なし)・`WidgetStore`(クラス)・`Color`(enum)・`Widget`(interface)・`WidgetId`(type)が非関数宣言。`loadConfig` は「`config` を含む名前の関数」で suggestions 検証用。`applyConfig` はアロー関数のリグレッション確認用。

- [ ] **Step 2: 失敗するテストを書く**

`test/target-resolver.test.mjs` の末尾に追加:

```js
test('オブジェクト定数を指定すると not-a-function になり kind と場所を返す', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'API_CONFIG' }, root);
  assert.equal(r.status, 'not-a-function');
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].kind, 'variable');
  assert.equal(r.matches[0].relFile, 'src/config.ts');
  assert.ok(r.matches[0].startLine >= 1);
  assert.ok(r.matches[0].signature.includes('API_CONFIG'));
});

test('プリミティブ定数・初期化子なし変数も not-a-function(kind: variable)になる', () => {
  const { root, proj: p } = proj('not-a-function');
  assert.equal(resolveTarget(ts, p, { functionName: 'MAX_RETRIES' }, root).status, 'not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'counter' }, root);
  assert.equal(r.status, 'not-a-function');
  assert.equal(r.matches[0].kind, 'variable');
});

test('クラス・enum・interface・type も not-a-function になり kind を区別する', () => {
  const { root, proj: p } = proj('not-a-function');
  const kinds = ['WidgetStore', 'Color', 'Widget', 'WidgetId'].map(
    (n) => resolveTarget(ts, p, { functionName: n }, root)
  );
  assert.ok(kinds.every((r) => r.status === 'not-a-function'));
  assert.deepEqual(kinds.map((r) => r.matches[0].kind), ['class', 'enum', 'interface', 'type']);
});

test('not-a-function でも部分一致の関数候補を suggestions に返す', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'config' }, root);
  assert.equal(r.status, 'not-a-function');
  assert.ok(r.suggestions.some((s) => s.name === 'loadConfig'));
});

test('完全な typo は従来どおり not-found、アロー関数の const は従来どおり resolved', () => {
  const { root, proj: p } = proj('not-a-function');
  assert.equal(resolveTarget(ts, p, { functionName: 'zzz_nosuch' }, root).status, 'not-found');
  const r = resolveTarget(ts, p, { functionName: 'applyConfig' }, root);
  assert.equal(r.status, 'resolved');
  assert.equal(r.declaration.kind, 'arrow');
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/target-resolver.test.mjs`
Expected: 追加した 5 テストが FAIL(`r.status` が `'not-found'` のため assert.equal で不一致)。既存 5 テストは PASS のまま。

- [ ] **Step 4: collectNonFunctionDeclarations と resolveTarget の分岐を実装する**

`lib/target-resolver.mjs` の `collectDeclarations` の後(`resolveTarget` の前)に追加:

```js
/**
 * 指定名に一致する「関数以外の名前付き宣言」を走査する(not-a-function 判定用)。
 * resolveTarget の not-found 経路でのみ呼ばれるフォールバックで、
 * 対象は 変数(初期化子が関数でない/なし)・クラス・enum・interface・type エイリアス。
 * relFile はここでは計算しない(呼び出し側で projectRoot を使って解決する)。
 */
export function collectNonFunctionDeclarations(ts, proj, name) {
  const matches = [];
  for (const sf of proj.program.getSourceFiles()) {
    if (!proj.isInternal(sf.fileName)) continue;
    const visit = (node) => {
      let nameNode = null;
      let kind = null;
      let rangeNode = node;

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
        nameNode = node.name;
        kind = 'class';
      } else if (ts.isEnumDeclaration(node)) {
        nameNode = node.name;
        kind = 'enum';
      } else if (ts.isInterfaceDeclaration(node)) {
        nameNode = node.name;
        kind = 'interface';
      } else if (ts.isTypeAliasDeclaration(node)) {
        nameNode = node.name;
        kind = 'type';
      }

      if (nameNode && nameNode.text === name) {
        const start = sf.getLineAndCharacterOfPosition(rangeNode.getStart(sf));
        matches.push({
          file: sf.fileName,
          relFile: null,
          kind,
          startLine: start.line + 1,
          signature: sf.text.slice(rangeNode.getStart(sf), rangeNode.getEnd()).split('\n')[0].slice(0, 120),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return matches;
}
```

`resolveTarget` 末尾の not-found 経路を次のように変更(既存の 2 行を置き換え):

```js
  const lower = name.toLowerCase();
  const suggestions = decls.filter((d) => d.name.toLowerCase().includes(lower)).slice(0, 10);

  // 関数として見つからない場合、関数以外の名前付き宣言として実在しないか確認する(issue #8)
  const nonFunctions = collectNonFunctionDeclarations(ts, proj, name).map((m) => ({
    ...m,
    relFile: path.relative(projectRoot, m.file),
  }));
  if (nonFunctions.length > 0) return { status: 'not-a-function', matches: nonFunctions, suggestions };

  return { status: 'not-found', suggestions };
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/target-resolver.test.mjs`
Expected: 全 10 テスト PASS。

- [ ] **Step 6: 全 unit テストでリグレッションを確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test`
Expected: 全テスト PASS(`collectDeclarations` 無変更のため graph-builder / callback-edges 系も green)。`npm test` は `node --test "test/*.test.mjs"` のエイリアス。

- [ ] **Step 7: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/lib/target-resolver.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/target-resolver.test.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/fixtures/not-a-function/
git commit -m "fix(cc-func-understand): 非関数宣言の指定を not-a-function として検出 (#8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: CLI に not-a-function の出力分岐を追加

**Files:**
- Modify: `plugins/cc-func-understand/skills/func-understand/scripts/analyze-callgraph.mjs:96-100` 付近
- Test: `plugins/cc-func-understand/skills/func-understand/scripts/test/cli.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `resolveTarget` 戻り値 `{ status: 'not-a-function', matches, suggestions }`
- Produces: stdout に 1 行 JSON `{ "status": "not-a-function", "matches": [...], "suggestions": [...] }`、exit code 2。graph.json(`--out`)は生成しない。

- [ ] **Step 1: 失敗する E2E テストを書く**

`test/cli.test.mjs` の「見つからない名前は exit 2 で近似候補を返す」テストの直後に追加:

```js
test('非関数の変数名は exit 2 で not-a-function と kind・場所を返す', () => {
  const outPath = tmp();
  const r = run(['--project', path.join(here, 'fixtures/not-a-function'), '--function', 'API_CONFIG', '--out', outPath]);
  assert.equal(r.code, 2);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'not-a-function');
  assert.equal(status.matches[0].kind, 'variable');
  assert.ok(status.matches[0].relFile && status.matches[0].startLine);
  assert.ok(Array.isArray(status.suggestions));
  assert.ok(!fs.existsSync(outPath));
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/cli.test.mjs`
Expected: 追加テストが FAIL。resolveTarget は `not-a-function` を返すが CLI に分岐がないため、`resolution.declaration` を参照する後続処理でエラーになり exit 1(または未定義参照のスタックトレース)になる。

- [ ] **Step 3: 出力分岐を実装する**

`analyze-callgraph.mjs` の `not-found` 分岐(96-100 行付近)の直後に追加:

```js
  if (resolution.status === 'not-a-function') {
    process.stdout.write(
      `${JSON.stringify({ status: 'not-a-function', matches: resolution.matches, suggestions: resolution.suggestions })}\n`
    );
    process.exitCode = 2;
    return;
  }
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && node --test test/cli.test.mjs`
Expected: 全 CLI テスト PASS。

- [ ] **Step 5: 全テスト(unit + Playwright smoke)を実行する**

Run: `cd plugins/cc-func-understand/skills/func-understand/scripts && npm test && npm run test:smoke`
Expected: unit 全 PASS。Playwright smoke(`test:smoke`)はブラウザ未インストール等で実行できない環境なら skip 可(その場合は結果に明記する)。

- [ ] **Step 6: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/scripts/analyze-callgraph.mjs \
        plugins/cc-func-understand/skills/func-understand/scripts/test/cli.test.mjs
git commit -m "fix(cc-func-understand): CLI に not-a-function の出力分岐を追加 (#8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: SKILL.md ハンドリング追記・README・バージョン更新

**Files:**
- Modify: `plugins/cc-func-understand/skills/func-understand/SKILL.md:69-70` 付近(exit 2 ハンドリング一覧)
- Modify: `plugins/cc-func-understand/README.md`(変更履歴)
- Modify: `plugins/cc-func-understand/.claude-plugin/plugin.json`(version)

**Interfaces:**
- Consumes: Task 2 の JSON 出力形式 `{ status: "not-a-function", matches, suggestions }`
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: SKILL.md に not-a-function のハンドリングを追記する**

`SKILL.md` の `- **exit 2, \`status: "ambiguous"\`**` の箇条書きと `- **exit 2, \`status: "not-found"\`**` の箇条書きの間に、次の1項目を挿入する:

```markdown
- **exit 2, `status: "not-a-function"`**: 指定名は実在するが関数ではない。`matches` の各要素を使い「`NAME` は kind(variable/class/enum/interface/type)として `relFile:startLine` に実在しますが、関数ではないため呼び出しグラフの起点にできません」とユーザーに説明する(複数一致時はすべて列挙)。`suggestions` が空でなければ候補として提示し、関数名の再入力を促す(AskUserQuestion または自由入力での確認)。
```

- [ ] **Step 2: README の変更履歴とバージョンを更新する**

`README.md` の `## 変更履歴` の先頭(v0.5.0 の行の上)に追加:

```markdown
- v0.5.1: 関数以外の変数・クラス等を指定したときに not-found ではなく「実在するが関数ではない」と分かるエラー(not-a-function)を返すように(issue #8)。
```

`.claude-plugin/plugin.json` の `"version": "0.5.0"` を `"version": "0.5.1"` に変更。

- [ ] **Step 3: 記載内容の整合を確認する**

Run: `cd plugins/cc-func-understand && grep -n "not-a-function" skills/func-understand/SKILL.md README.md && grep -n '"version"' .claude-plugin/plugin.json`
Expected: SKILL.md に1箇所・README に1箇所・version が 0.5.1。

- [ ] **Step 4: コミット**

```bash
git add plugins/cc-func-understand/skills/func-understand/SKILL.md \
        plugins/cc-func-understand/README.md \
        plugins/cc-func-understand/.claude-plugin/plugin.json
git commit -m "docs(cc-func-understand): not-a-function のハンドリング追記と v0.5.1 (#8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
