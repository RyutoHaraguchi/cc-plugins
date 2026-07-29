import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { classifySymbolFile } from '../lib/symbol-classifier.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

// パス判定のみを検証するためのスタブ(program に解決先が無いケースの安全性も兼ねる)
const stubProgram = { getSourceFile: () => undefined };

test('@types/node のパスは stdlib、他の @types パッケージは誤爆しない', () => {
  assert.equal(classifySymbolFile(stubProgram, '/p/node_modules/@types/node/fs.d.ts'), 'stdlib');
  assert.equal(classifySymbolFile(stubProgram, '/p/node_modules/@types/node/index.d.ts'), 'stdlib');
  assert.equal(classifySymbolFile(stubProgram, '/p/node_modules/@types/node-fetch/index.d.ts'), 'other');
  assert.equal(classifySymbolFile(stubProgram, '/p/src/node/index.ts'), 'other');
  // Windows 形式のパス区切りでも判定できる
  assert.equal(classifySymbolFile(stubProgram, 'C:\\p\\node_modules\\@types\\node\\fs.d.ts'), 'stdlib');
});

test('default library は program の公式 API で stdlib 判定される', () => {
  const projectRoot = path.join(here, 'fixtures', 'basic');
  const proj = loadProject(ts, projectRoot);
  const libPath = ts.getDefaultLibFilePath(proj.program.getCompilerOptions());
  const libSf = proj.program.getSourceFile(libPath);
  assert.ok(libSf, 'default lib が program に含まれている前提を確認');
  assert.equal(classifySymbolFile(proj.program, libSf.fileName), 'stdlib');
  // プロジェクト内ファイルは other
  assert.equal(classifySymbolFile(proj.program, path.join(projectRoot, 'src', 'service.ts')), 'other');
});
