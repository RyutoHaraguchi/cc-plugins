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
