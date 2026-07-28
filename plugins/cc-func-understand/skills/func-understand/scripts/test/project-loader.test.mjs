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
