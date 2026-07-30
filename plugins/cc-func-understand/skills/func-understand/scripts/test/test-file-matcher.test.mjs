import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, createMatcher, loadTestExclusions, createFileExcluder } from '../lib/test-file-matcher.mjs';

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

test('globToRegExp: {} 内の正規表現特殊文字はリテラル扱い', () => {
  const re = globToRegExp('**/*{.test,.spec}.ts');
  assert.ok(re.test('src/a.test.ts'));
  assert.ok(re.test('src/a.spec.ts'));
  assert.ok(!re.test('src/aXtest.ts'), '{} 内の . が正規表現の任意一文字として解釈されない');
});

test('globToRegExp: {} 内のワイルドカードは、どのパターンのどこが不正かが分かるエラーになる', () => {
  assert.throws(
    () => globToRegExp('src/{a*b,c}.ts'),
    (e) => e.message.includes('src/{a*b,c}.ts') && e.message.includes('{a*b,c}') && e.message.includes('*'),
    'パターン全体と不正な {} と文字がメッセージに含まれる',
  );
  assert.throws(() => globToRegExp('src/{a?b}.ts'), /\?/);
});

test('createMatcher: 複数パターンのいずれかにマッチし、パス区切りを正規化する', () => {
  const m = createMatcher(['**/*.test.*', '**/__tests__/**']);
  assert.ok(m('__tests__/foo.ts'));
  assert.ok(m('src\\a\\foo.test.ts'), 'Windows 区切りでも判定できる');
  assert.ok(m('./src/a/foo.test.ts'), '先頭 ./ を無視する');
  assert.ok(!m('src/a/foo.ts'));
});

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

test('loadTestExclusions: 末尾スラッシュのパターンは dir/** に正規化される(サイレント no-op 防止)', () => {
  const r = loadTestExclusions(tmpConfig('{"testExclude": ["test/", "src/**"]}'));
  assert.deepEqual(r.globs, ['test/**', 'src/**']);
});

test('createFileExcluder: projectRoot 相対で判定し、外側は除外しない', () => {
  const ex = createFileExcluder('/p', ['**/*.test.*']);
  assert.ok(ex('/p/src/a.test.ts'));
  assert.ok(!ex('/p/src/a.ts'));
  assert.ok(!ex('/outside/a.test.ts'), 'projectRoot 外は対象にしない');
  assert.ok(!ex('/p'), 'projectRoot 自身は対象にしない');
});
