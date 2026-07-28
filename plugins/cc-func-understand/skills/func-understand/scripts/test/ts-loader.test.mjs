import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { loadTypeScript } from '../lib/ts-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('typescript が無いプロジェクトでは同梱版 TS 5系にフォールバックする', () => {
  // リポジトリツリー外の一時ディレクトリでテストし、walk-up が本当に何も見つけないようにする
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-func-understand-test-'));
  try {
    const { ts, source, version } = loadTypeScript(tmpDir);
    assert.equal(source, 'bundled');
    assert.match(version, /^5\./);
    assert.equal(typeof ts.createLanguageService, 'function');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createLanguageService を持つプロジェクト版 TS があればそれを使う', () => {
  // scripts/ 自身は typescript ~5.9.3 を持つプロジェクトとして扱える
  const { source, version } = loadTypeScript(path.join(here, '..'));
  assert.equal(source, 'project');
  assert.match(version, /^5\.9\./);
});
