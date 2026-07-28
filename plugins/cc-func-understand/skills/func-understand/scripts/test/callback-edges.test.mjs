import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';
import { buildGraph } from '../lib/graph-builder.mjs';
import { addCallbackEdges } from '../lib/callback-edges.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

function fullGraph(fn) {
  const projectRoot = path.join(here, 'fixtures/callback');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: fn }, projectRoot);
  const g = buildGraph(ts, proj, r.declaration, { projectRoot });
  return addCallbackEdges(ts, proj, g, { projectRoot });
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);

test('Call Hierarchy 単独では検出できない名前渡しが callback-passed エッジになる', () => {
  const g = fullGraph('itemHandler');
  const setup = byName(g, 'setupRoutes');
  const processAll = byName(g, 'processAll');
  assert.ok(setup, 'register("/item", itemHandler) の登録元が検出される');
  assert.ok(processAll, 'ids.map(itemHandler) の利用元が検出される');
  const target = byName(g, 'itemHandler');
  const e1 = g.edges.find((x) => x.from === setup.id && x.to === target.id);
  assert.equal(e1.kind, 'callback-passed');
  const e2 = g.edges.find((x) => x.from === processAll.id && x.to === target.id);
  assert.equal(e2.kind, 'callback-passed');
});

test('参照元からさらに上流 BFS が継続し boot まで到達する', () => {
  const g = fullGraph('itemHandler');
  assert.ok(byName(g, 'boot'), 'setupRoutes の呼び出し元 boot に到達(ルーティング層まで遡れる)');
});

test('直接呼び出しは callback-passed として二重計上されない', () => {
  const projectRoot = path.join(here, 'fixtures/basic');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: 'formatName' }, projectRoot);
  const g = addCallbackEdges(ts, proj, buildGraph(ts, proj, r.declaration, { projectRoot }), { projectRoot });
  assert.ok(!g.edges.some((e) => e.kind === 'callback-passed'), 'basic には名前渡しが無い');
});

test('新規発見ノード(setupRoutes/boot)は upstreamDistance と _selection を正しく持つ', () => {
  const g = fullGraph('itemHandler');
  const setup = byName(g, 'setupRoutes');
  const boot = byName(g, 'boot');
  assert.equal(setup.upstreamDistance, 1, 'setupRoutes は itemHandler の1つ上流');
  assert.equal(typeof setup._selection?.file, 'string');
  assert.equal(typeof setup._selection?.start, 'number');
  assert.equal(boot.upstreamDistance, 2, 'boot は setupRoutes 経由でさらに1つ上流');
  assert.equal(typeof boot._selection?.file, 'string');
  assert.equal(typeof boot._selection?.start, 'number');
});

test('`export default X;` は単なる再エクスポートであり callback-passed エッジを生まない', () => {
  const projectRoot = path.join(here, 'fixtures/export-default');
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: 'helper' }, projectRoot);
  const g = addCallbackEdges(ts, proj, buildGraph(ts, proj, r.declaration, { projectRoot }), { projectRoot });
  assert.ok(
    !g.edges.some((e) => e.kind === 'callback-passed'),
    '`export default helper;` は関数参照の受け渡しではなく再エクスポートなので callback-passed 扱いにならないべき',
  );
});

test('同一関数が同じ対象を直接呼び出しと名前渡しの両方で行っても direct-call と callback-passed が共存する(edge-kind 衝突しない)', () => {
  const g = fullGraph('itemHandler');
  const mixed = byName(g, 'mixedUsage');
  const target = byName(g, 'itemHandler');
  assert.ok(mixed, 'mixedUsage(itemHandler を直接呼び出しつつ別行で名前渡しもする)が検出される');
  const direct = g.edges.find((e) => e.from === mixed.id && e.to === target.id && e.kind === 'direct-call');
  const callback = g.edges.find((e) => e.from === mixed.id && e.to === target.id && e.kind === 'callback-passed');
  assert.ok(direct, 'direct-call エッジが callback-passed に握り潰されずに残る');
  assert.ok(callback, 'callback-passed エッジが direct-call に吸収されずに追加される');
  assert.deepEqual(direct.callLines, [19], 'direct-call の callLines は呼び出し行のみを含む');
  assert.deepEqual(callback.callLines, [20], 'callback-passed の callLines は名前渡し行のみを含む');
});
