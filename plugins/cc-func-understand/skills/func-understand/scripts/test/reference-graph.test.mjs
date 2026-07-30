import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { collectModuleValueDeclarations } from '../lib/target-resolver.mjs';
import { buildReferenceGraph } from '../lib/reference-graph.mjs';
import { addCallbackEdges } from '../lib/callback-edges.mjs';
import { createFileExcluder } from '../lib/test-file-matcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, 'fixtures/reference-graph');
const { ts } = loadTypeScript(path.join(here, '..'));

function analyze(name, buildOpts = {}, { withUpstreamPass = false } = {}) {
  const proj = loadProject(ts, projectRoot);
  const decls = collectModuleValueDeclarations(ts, proj, name).map((d) => ({
    ...d,
    relFile: path.relative(projectRoot, d.file),
  }));
  assert.equal(decls.length, 1, `${name} はモジュールレベルの値宣言として一意に見つかるはず`);
  let g = buildReferenceGraph(ts, proj, decls[0], { projectRoot, ...buildOpts });
  if (withUpstreamPass) g = addCallbackEdges(ts, proj, g, { projectRoot });
  return g;
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);
const edgesBetween = (g, from, to) => g.edges.filter((e) => e.from === from.id && e.to === to.id);

test('起点の変数ノード: kind variable / upstreamDistance 0 / 宣言文の code を持つ', () => {
  const g = analyze('SETTINGS');
  const target = g.nodes.find((n) => n.id === g.target);
  assert.equal(target.name, 'SETTINGS');
  assert.equal(target.kind, 'variable');
  assert.equal(target.internal, true);
  assert.equal(target.upstreamDistance, 0);
  assert.equal(target.downstreamDistance, null);
  assert.ok(target.code.includes('SETTINGS'));
  assert.equal(target.file, 'src/config.ts');
});

test('変数を読む関数へ reads エッジが張られ upstreamDistance 1 になる', () => {
  const g = analyze('SETTINGS');
  const reader = byName(g, 'readSettings');
  assert.ok(reader, 'SETTINGS を読む readSettings がノード化される');
  assert.equal(reader.upstreamDistance, 1);
  const reads = edgesBetween(g, reader, byName(g, 'SETTINGS')).filter((e) => e.kind === 'reads');
  assert.equal(reads.length, 1);
  assert.ok(reads[0].callLines.length >= 1);
});

test('reads で発見した関数から上流 BFS が継続する(handler が direct-call で乗る)', () => {
  const g = analyze('SETTINGS');
  const handler = byName(g, 'handler');
  assert.ok(handler, 'readSettings の呼び出し元 handler に到達する');
  assert.equal(handler.upstreamDistance, 2);
  const e = edgesBetween(g, handler, byName(g, 'readSettings'));
  assert.equal(e[0].kind, 'direct-call');
});

test('import 文中の参照は reads エッジにならない', () => {
  const g = analyze('SETTINGS');
  // reader.ts / toplevel.ts / excluded-reader.ts の import 行は 1 行目。
  // どの reads エッジの callLines にも 1 行目が含まれないこと。
  for (const e of g.edges.filter((x) => x.kind === 'reads')) {
    assert.ok(!e.callLines.includes(1), `import 行が reads として計上されている: ${JSON.stringify(e)}`);
  }
});

test('同名ローカル変数(localShadow 内)は別シンボルなので拾われない', () => {
  const g = analyze('SETTINGS');
  const shadow = byName(g, 'localShadow');
  assert.equal(shadow, undefined, 'localShadow は SETTINGS を参照していないためグラフに乗らない');
});

test('モジュールトップレベルの参照は module ノードから reads エッジになる', () => {
  const g = analyze('SETTINGS');
  const mod = g.nodes.find((n) => n.kind === 'module' && n.name === 'src/toplevel.ts');
  assert.ok(mod, 'toplevel.ts が module ノード化される');
  const reads = edgesBetween(g, mod, byName(g, 'SETTINGS')).filter((e) => e.kind === 'reads');
  assert.equal(reads.length, 1);
});

test('enum も起点にでき、読み取り関数へ reads エッジが張られる', () => {
  const g = analyze('Mode');
  const target = g.nodes.find((n) => n.id === g.target);
  assert.equal(target.kind, 'enum');
  const picker = byName(g, 'pickMode');
  assert.ok(picker, 'Mode を読む pickMode がノード化される');
  assert.ok(edgesBetween(g, picker, target).some((e) => e.kind === 'reads'));
});

test('型位置のみの参照(型注釈)も reads エッジになる', () => {
  const g = analyze('Mode');
  const describe = byName(g, 'describeMode');
  assert.ok(describe, '型注釈でのみ Mode を参照する describeMode もノード化される');
  const reads = edgesBetween(g, describe, g.nodes.find((n) => n.id === g.target)).filter((e) => e.kind === 'reads');
  assert.equal(reads.length, 1);
});

test('テスト除外ファイル内の参照はノード化されない', () => {
  const isFileExcluded = createFileExcluder(projectRoot, ['**/excluded-reader.ts']);
  const g = analyze('SETTINGS', { isFileExcluded });
  assert.equal(byName(g, 'exReader'), undefined);
});

test('除外なしなら exReader も乗る(対照)', () => {
  const g = analyze('SETTINGS');
  assert.ok(byName(g, 'exReader'));
});

test('`export default SETTINGS;` の裸の再エクスポートは reads エッジにならない', () => {
  const g = analyze('SETTINGS');
  const mod = g.nodes.find((n) => n.kind === 'module' && n.name === 'src/reexport.ts');
  assert.equal(mod, undefined, 'reexport.ts は export default の対象以外に SETTINGS を参照していないため module ノード化されないはず');
});

test('maxNodes 到達時はノード化せず truncation.frontier に積む', () => {
  const g = analyze('SETTINGS', { maxNodes: 1 });
  assert.equal(g.nodes.length, 1, '起点のみ');
  assert.equal(g.truncation.reason, 'max-nodes');
  assert.ok(g.truncation.frontier.includes('readSettings'));
});

test('upstreamDepth 0 では読み取り関数を発見しない(起点のみ)', () => {
  const g = analyze('SETTINGS', { upstreamDepth: 0 });
  assert.equal(g.nodes.length, 1);
});

test('後段 addCallbackEdges で名前渡しの上流(passes)も検出される', () => {
  const g = analyze('SETTINGS', {}, { withUpstreamPass: true });
  const passes = byName(g, 'passes');
  assert.ok(passes, '[readSettings] の名前渡しをする passes が上流ノード化される');
  const cb = edgesBetween(g, passes, byName(g, 'readSettings')).filter((e) => e.kind === 'callback-passed');
  assert.equal(cb.length, 1);
});
