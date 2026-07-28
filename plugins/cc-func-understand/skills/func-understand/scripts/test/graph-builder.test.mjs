import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';
import { buildGraph } from '../lib/graph-builder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ts } = loadTypeScript(path.join(here, '..'));

function graphFor(fixture, fn, opts = {}) {
  const projectRoot = path.join(here, 'fixtures', fixture);
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: fn }, projectRoot);
  assert.equal(r.status, 'resolved');
  return buildGraph(ts, proj, r.declaration, { projectRoot, ...opts });
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);

test('basic: 上流はルーティング層、下流はユーティリティと外部境界まで辿る', () => {
  const g = graphFor('basic', 'getUser');
  const target = byName(g, 'getUser');
  assert.equal(target.upstreamDistance, 0);
  assert.equal(target.downstreamDistance, 0);
  assert.equal(byName(g, 'handleGetUser').upstreamDistance, 1);   // 上流
  assert.equal(byName(g, 'formatName').downstreamDistance, 1);    // 下流
  const boundary = byName(g, 'basename');
  assert.equal(boundary.kind, 'external-boundary');
  assert.equal(boundary.internal, false);
  assert.equal(boundary.code, undefined);                          // 境界は code なし
  const e = g.edges.find((x) => x.from === target.id && x.to === byName(g, 'formatName').id);
  assert.equal(e.kind, 'direct-call');
  assert.ok(e.callLines.length >= 1);
});

test('cycle: 相互再帰は方向別 distance を持ち無限ループしない', () => {
  const g = graphFor('cycle', 'pingA');
  const b = byName(g, 'pingB');
  assert.equal(b.upstreamDistance, 1);    // pingB は pingA を呼ぶ(上流)
  assert.equal(b.downstreamDistance, 1);  // pingA は pingB を呼ぶ(下流)
  assert.ok(g.nodes.length <= 3); // pingA, pingB(+ module があっても3以下)
});

test('barrel: バレル経由の呼び出しは元宣言ノードに解決される', () => {
  const g = graphFor('barrel', 'realImpl');
  const caller = byName(g, 'consume');
  assert.ok(caller, 'バレル経由でも consumer が上流として検出される');
  assert.equal(caller.upstreamDistance, 1);
});

test('truncation: maxNodes 到達で打ち切り情報を記録する', () => {
  const g = graphFor('basic', 'getUser', { maxNodes: 2 });
  assert.ok(g.truncation);
  assert.equal(g.truncation.reason, 'max-nodes');
  assert.ok(typeof g.truncation.upstreamCount === 'number');
  assert.ok(typeof g.truncation.downstreamCount === 'number');
  assert.ok(Array.isArray(g.truncation.frontier));
});

test('code はノードあたり 16KB で切り詰められる', () => {
  const g = graphFor('basic', 'getUser');
  for (const n of g.nodes.filter((n) => n.internal)) {
    assert.ok(Buffer.byteLength(n.code, 'utf8') <= 16 * 1024);
    assert.equal(typeof n.codeTruncated, 'boolean');
  }
});
