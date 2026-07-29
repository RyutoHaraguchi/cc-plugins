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
