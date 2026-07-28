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
