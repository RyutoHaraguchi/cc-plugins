import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../lib/ts-loader.mjs';
import { loadProject } from '../lib/project-loader.mjs';
import { resolveTarget } from '../lib/target-resolver.mjs';
import { buildGraph } from '../lib/graph-builder.mjs';
import { addDownstreamCallbacks } from '../lib/downstream-callbacks.mjs';
import { addCallbackEdges } from '../lib/callback-edges.mjs';
import { createFileExcluder } from '../lib/test-file-matcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, 'fixtures/downstream-callback');
const { ts } = loadTypeScript(path.join(here, '..'));

function analyze(fn, buildOpts = {}, { withUpstreamPass = true } = {}) {
  const proj = loadProject(ts, projectRoot);
  const r = resolveTarget(ts, proj, { functionName: fn }, projectRoot);
  let g = buildGraph(ts, proj, r.declaration, { projectRoot, ...buildOpts });
  g = addDownstreamCallbacks(ts, proj, g, { projectRoot });
  if (withUpstreamPass) g = addCallbackEdges(ts, proj, g, { projectRoot });
  return g;
}

const byName = (g, name) => g.nodes.find((n) => n.name === name);
const edgesBetween = (g, from, to) => g.edges.filter((e) => e.from === from.id && e.to === to.id);

test('items.map(helper) の helper が下流ノード + callback-passed エッジになる', () => {
  const g = analyze('target');
  const target = byName(g, 'target');
  const helper = byName(g, 'helper');
  assert.ok(helper, '名前渡しされた helper がノード化される');
  assert.equal(helper.downstreamDistance, 1);
  const cb = edgesBetween(g, target, helper).filter((e) => e.kind === 'callback-passed');
  assert.equal(cb.length, 1);
});

test('map(helper) と register("t", helper) の2箇所が1本のエッジに行マージされる', () => {
  const g = analyze('target');
  const cb = edgesBetween(g, byName(g, 'target'), byName(g, 'helper')).find((e) => e.kind === 'callback-passed');
  assert.equal(cb.callLines.length, 2, 'map 行と register 行の両方が記録される');
});

test('items.map(utils.fmt) は direct-call のみで callback-passed と二重計上されない', () => {
  const g = analyze('target');
  const edges = edgesBetween(g, byName(g, 'target'), byName(g, 'fmt'));
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, 'direct-call');
});

test('発見された helper の下流(normalize)が direct-call で継続探索される', () => {
  const g = analyze('target');
  const normalize = byName(g, 'normalize');
  assert.ok(normalize, 'helper が呼ぶ normalize もノード化される');
  assert.equal(normalize.downstreamDistance, 2);
  const edges = edgesBetween(g, byName(g, 'helper'), normalize);
  assert.equal(edges[0].kind, 'direct-call');
});

test('後段 addCallbackEdges が新ノード helper への上流(otherUser)も検出する', () => {
  const g = analyze('target');
  const otherUser = byName(g, 'otherUser');
  assert.ok(otherUser, '同じ helper を渡す otherUser が上流ノード化される');
  const cb = edgesBetween(g, otherUser, byName(g, 'helper')).filter((e) => e.kind === 'callback-passed');
  assert.equal(cb.length, 1);
});

test('パラメータの名前渡し items.map(cb) は誤検出されない', () => {
  const g = analyze('applyEach');
  assert.ok(!byName(g, 'cb'), 'パラメータはリポ内関数宣言に解決されないため落ちる');
  assert.equal(g.nodes.filter((n) => n.internal).length, 1, 'applyEach 自身のみ');
});

test('downstreamDepth による打ち切り: 上限に達した包含ノードからは発見しない', () => {
  // 深さ0: target 自身が上限に達しているため、本体からの発見を行わない
  // (深さ1のケースは continueDownstream 側の制限だけでも normalize が出ないため、
  //  発見側ガードの失敗テストとしては深さ0の境界を使う)
  const g0 = analyze('target', { downstreamDepth: 0 }, { withUpstreamPass: false });
  assert.ok(!byName(g0, 'helper'), '深さ0では target 本体からの発見も行わない');
  const g1 = analyze('target', { downstreamDepth: 1 }, { withUpstreamPass: false });
  assert.ok(byName(g1, 'helper'), '深さ1では target 直下の発見は行われる');
  assert.ok(!byName(g1, 'normalize'), '発見された helper から先の探索は打ち切られる');
});

test('maxNodes 到達時はノード化せず truncation.frontier に積む', () => {
  // buildGraph 段階で target / fmt / register の3ノードで予算を使い切る
  const g = analyze('target', { maxNodes: 3 }, { withUpstreamPass: false });
  assert.ok(!byName(g, 'helper'));
  assert.equal(g.truncation.reason, 'max-nodes');
  assert.ok(g.truncation.frontier.includes('helper'));
});

test('テスト除外ファイル内の宣言に解決される名前渡しは発見されない', () => {
  const isFileExcluded = createFileExcluder(projectRoot, ['**/excluded.ts']);
  const g = analyze('usesExcluded', { isFileExcluded });
  assert.ok(!byName(g, 'exHelper'));
});

test('除外なしなら excluded.ts の exHelper も発見される(対照)', () => {
  const g = analyze('usesExcluded');
  assert.ok(byName(g, 'exHelper'));
  assert.equal(byName(g, 'exHelper').downstreamDistance, 1);
});
