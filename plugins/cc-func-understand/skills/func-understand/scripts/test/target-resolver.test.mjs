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
