import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'analyze-callgraph.mjs');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-')), 'graph.json');

function run(args) {
  try {
    const stdout = execFileSync('node', [cli, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('basic を end-to-end で解析し、スキーマ通りの JSON を出力する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'getUser', '--out', out]);
  assert.equal(r.code, 0);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'ok');
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.match(g.meta.tsVersion, /^5\./);
  assert.ok(g.meta.limitations.includes('dynamic-calls'));
  assert.equal(g.meta.tsconfig, 'tsconfig.json');
  assert.ok(!path.isAbsolute(g.meta.tsconfig));
  assert.ok(g.target.includes('service.ts#'));
  assert.ok(g.nodes.every((n) => !('_selection' in n)));
  assert.ok(g.nodes.every((n) => ['function','method','arrow','class','module','external-boundary'].includes(n.kind)));
});

test('曖昧な関数名は exit 2 で候補一覧を返す', () => {
  const r = run(['--project', path.join(here, 'fixtures/duplicate-symbols'), '--function', 'save', '--out', tmp()]);
  assert.equal(r.code, 2);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'ambiguous');
  assert.equal(status.candidates.length, 3);
  assert.ok(status.candidates[0].relFile && status.candidates[0].startLine);
});

test('見つからない名前は exit 2 で近似候補を返す', () => {
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'nosuch', '--out', tmp()]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'not-found');
});

test('callback fixture で参照エッジ込みの解析ができる(統合)', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/callback'), '--function', 'itemHandler', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.edges.some((e) => e.kind === 'callback-passed'));
  assert.ok(g.nodes.some((n) => n.name === 'boot'));
});

test('xss fixture のコードが JSON 内にそのまま保持される(エスケープは HTML 生成側の責務)', () => {
  const out = tmp();
  run(['--project', path.join(here, 'fixtures/xss'), '--function', 'renderPage', '--out', out]);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.nodes.find((n) => n.name === 'renderPage').code.includes('</script>'));
});

test('--max-nodes に数値以外を渡すと exit 1 で明確なエラーを返す', () => {
  const outPath = tmp();
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'getUser', '--max-nodes', 'abc', '--out', outPath]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--max-nodes/);
  assert.ok(!fs.existsSync(outPath));
});

test('コメント・末尾カンマ入りの tsconfig でも references を検出し limitations に project-references が入る', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/jsonc-refs'), '--function', 'getUser', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.meta.limitations.includes('project-references'));
});

test('solution-style tsconfig(files: [] + references)は exit 1 で --tsconfig の指定を促す', () => {
  const outPath = tmp();
  const r = run(['--project', path.join(here, 'fixtures/solution-style'), '--function', 'getUser', '--out', outPath]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /solution-style/);
  assert.match(r.stderr, /--tsconfig/);
  assert.ok(!fs.existsSync(outPath));
});

