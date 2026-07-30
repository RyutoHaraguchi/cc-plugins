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

test('モジュールレベルのオブジェクト定数は resolved-variable になり宣言情報を返す', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'API_CONFIG' }, root);
  assert.equal(r.status, 'resolved-variable');
  assert.equal(r.declaration.kind, 'variable');
  assert.equal(r.declaration.relFile, 'src/config.ts');
  assert.ok(r.declaration.selectionStart > 0);
  assert.ok(r.declaration.startLine >= 1);
});

test('プリミティブ定数・初期化子なし変数も resolved-variable になる', () => {
  const { root, proj: p } = proj('not-a-function');
  assert.equal(resolveTarget(ts, p, { functionName: 'MAX_RETRIES' }, root).status, 'resolved-variable');
  const r = resolveTarget(ts, p, { functionName: 'counter' }, root);
  assert.equal(r.status, 'resolved-variable');
  assert.equal(r.declaration.kind, 'variable');
});

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

test('not-a-function でも部分一致の関数候補を suggestions に返す', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'Config' }, root);
  assert.equal(r.status, 'not-a-function');
  assert.equal(r.matches[0].kind, 'interface');
  assert.ok(r.suggestions.some((s) => s.name === 'loadConfig'));
});

test('完全な typo は従来どおり not-found、アロー関数の const は従来どおり resolved', () => {
  const { root, proj: p } = proj('not-a-function');
  assert.equal(resolveTarget(ts, p, { functionName: 'zzz_nosuch' }, root).status, 'not-found');
  const r = resolveTarget(ts, p, { functionName: 'applyConfig' }, root);
  assert.equal(r.status, 'resolved');
  assert.equal(r.declaration.kind, 'arrow');
});

test('resolved-variable でも --file 絞り込みが効く(指定ファイル外は not-found)', () => {
  const { root, proj: p } = proj('not-a-function');
  const r1 = resolveTarget(ts, p, { functionName: 'API_CONFIG', file: 'src/other.ts' }, root);
  assert.equal(r1.status, 'not-found');
  const r2 = resolveTarget(ts, p, { functionName: 'API_CONFIG', file: 'src/config.ts' }, root);
  assert.equal(r2.status, 'resolved-variable');
});

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

test('関数内ローカル・catch 節・for-of 変数は not-found(ノイズにならない)', () => {
  const { root, proj: p } = proj('not-a-function');
  for (const name of ['LOCAL_CFG', 'caughtErr', 'loopItem']) {
    assert.equal(resolveTarget(ts, p, { functionName: name }, root).status, 'not-found', name);
  }
});

test('関数スコープの enum は collectNonFunctionDeclarations で not-a-function 返却される(退行防止)', () => {
  const { root, proj: p } = proj('not-a-function');
  const r = resolveTarget(ts, p, { functionName: 'LocalColor' }, root);
  assert.equal(r.status, 'not-a-function', 'nested enum はモジュールレベルでないため resolved-variable では拾えず not-a-function に落ちる');
  assert.equal(r.matches[0].kind, 'enum');
  assert.ok(r.matches[0].relFile && r.matches[0].startLine, '場所情報が保持される');
});
