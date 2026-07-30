import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'analyze-callgraph.mjs');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-')), 'graph.json');

function run(args) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
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

test('クラス名は exit 2 で not-a-function と kind・場所を返す', () => {
  const outPath = tmp();
  const r = run(['--project', path.join(here, 'fixtures/not-a-function'), '--function', 'WidgetStore', '--out', outPath]);
  assert.equal(r.code, 2);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'not-a-function');
  assert.equal(status.matches[0].kind, 'class');
  assert.ok(status.matches[0].relFile && status.matches[0].startLine);
  assert.ok(Array.isArray(status.suggestions));
  assert.ok(!fs.existsSync(outPath));
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

test('test-exclusion: .func-understand.json を自動読み込みしてテストを除外する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const names = g.nodes.map((n) => n.name);
  assert.ok(!names.some((n) => ['callInTest', 'helperCall', 'anotherTestCaller', 'passesFactory'].includes(n)));
  assert.ok(names.includes('useWidget'));
});

test('test-exclusion: --include-tests で定義ファイルを読まず全ノードが出る', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--include-tests', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const names = g.nodes.map((n) => n.name);
  assert.ok(names.includes('callInTest'));
  assert.ok(names.includes('passesFactory'), 'callback-passed 経路も復元される');
});

test('test-exclusion: 起点がテストファイル内なら除外を無効化する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'callInTest', '--out', out]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /起点がテストファイル/);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(g.nodes.some((n) => n.name === 'helperCall'), '除外が無効化されテスト内の下流も出る');
});

test('test-exclusion: --test-exclude の明示パスが存在しなければ exit 1', () => {
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--test-exclude', path.join(here, 'fixtures/nonexistent.json'), '--out', tmp()]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--test-exclude/);
});

test('test-exclusion: --test-exclude が壊れた JSON を指すと warning を出し除外なしで解析する', () => {
  const brokenConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-')), 'broken.json');
  fs.writeFileSync(brokenConfig, '{ this is not json');
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--test-exclude', brokenConfig, '--out', out]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /不正な JSON/);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const names = g.nodes.map((n) => n.name);
  assert.ok(names.includes('callInTest'), '除外設定が壊れているため除外なしで解析される');
});

test('test-exclusion: --include-tests + 壊れた --test-exclude では定義ファイルを一切読まず warning も出ない', () => {
  const brokenConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-')), 'broken.json');
  fs.writeFileSync(brokenConfig, '{ this is not json');
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/test-exclusion'), '--function', 'createWidget', '--include-tests', '--test-exclude', brokenConfig, '--out', out]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '', '--include-tests は定義ファイル自体を読まないため warning も出ない');
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const names = g.nodes.map((n) => n.name);
  assert.ok(names.includes('callInTest'));
});

test('downstream-callback fixture: 名前渡しされた関数が下流ノード化される(統合)', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/downstream-callback'), '--function', 'target', '--out', out]);
  assert.equal(r.code, 0);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  const helper = g.nodes.find((n) => n.name === 'helper');
  assert.ok(helper, 'items.map(helper) の helper がノード化される');
  assert.equal(helper.downstreamDistance, 1);
  assert.ok(g.edges.some((e) => e.kind === 'callback-passed' && e.to === helper.id));
  assert.ok(g.nodes.every((n) => !('_selection' in n)), '新ノードも _selection が strip される');
});

test('変数指定は参照グラフモードとして exit 0 / mode: reference のグラフを生成する', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/reference-graph'), '--function', 'SETTINGS', '--out', out]);
  assert.equal(r.code, 0);
  const status = JSON.parse(r.stdout);
  assert.equal(status.status, 'ok');
  assert.equal(status.mode, 'reference');
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(g.meta.mode, 'reference');
  const target = g.nodes.find((n) => n.id === g.target);
  assert.equal(target.kind, 'variable');
  assert.ok(g.edges.some((e) => e.kind === 'reads'));
  assert.ok(g.nodes.every((n) => !('_selection' in n)), '_selection が strip される');
});

test('関数グラフの stdout / meta に mode が付かない(既存出力不変)', () => {
  const out = tmp();
  const r = run(['--project', path.join(here, 'fixtures/basic'), '--function', 'getUser', '--out', out]);
  assert.equal(r.code, 0);
  assert.ok(!('mode' in JSON.parse(r.stdout)));
  assert.ok(!('mode' in JSON.parse(fs.readFileSync(out, 'utf8')).meta));
});

