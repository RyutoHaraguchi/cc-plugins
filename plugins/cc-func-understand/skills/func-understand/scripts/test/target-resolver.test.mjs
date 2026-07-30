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

test('not-a-function でも --file/--line で絞り込みが効く(指定ファイル外の同名変数は not-found になる)', () => {
  const { root, proj: p } = proj('not-a-function');
  // 指定ファイルが存在しないと not-found
  const r1 = resolveTarget(ts, p, { functionName: 'API_CONFIG', file: 'src/other.ts' }, root);
  assert.equal(r1.status, 'not-found');
  // 正しいファイルを指定すると not-a-function
  const r2 = resolveTarget(ts, p, { functionName: 'API_CONFIG', file: 'src/config.ts' }, root);
  assert.equal(r2.status, 'not-a-function');
  assert.equal(r2.matches.length, 1);
});

test('not-a-function の --line 絞り込み: 同名変数が複数ファイル/複数行にあるとき行で一意に絞れる', () => {
  const { root, proj: p } = proj('not-a-function');
  // 絞り込みなしでは site-a.ts / site-b.ts の 2 件がマッチする
  const all = resolveTarget(ts, p, { functionName: 'SITE_LIMIT' }, root);
  assert.equal(all.status, 'not-a-function');
  assert.equal(all.matches.length, 2);
  const siteB = all.matches.find((m) => m.relFile === 'src/site-b.ts');
  assert.ok(siteB.startLine > 1, 'site-b.ts 側はパディングにより行番号がずれている(--line で区別できる前提)');
  // --line 指定で site-b.ts 側の 1 件に絞れる
  const r = resolveTarget(ts, p, { functionName: 'SITE_LIMIT', line: siteB.startLine }, root);
  assert.equal(r.status, 'not-a-function');
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].relFile, 'src/site-b.ts');
  // どの宣言の行範囲にも入らない行を指定すると not-found
  assert.equal(resolveTarget(ts, p, { functionName: 'SITE_LIMIT', line: 999 }, root).status, 'not-found');
});
