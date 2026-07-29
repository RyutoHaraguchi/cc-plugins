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

test('外部境界ノードはシンボル単位で重複排除される(複数の呼び出し元があっても1ノード)', () => {
  // basic fixture: getUser が直接 basename を呼び、formatName(getUser の下流)も basename を呼ぶ。
  // 呼び出し元が2つあっても external-boundary ノードは1個に集約されるべき。
  const g = graphFor('basic', 'getUser');
  const boundaryNodes = g.nodes.filter((n) => n.kind === 'external-boundary' && n.name === 'basename');
  assert.equal(boundaryNodes.length, 1, 'basename は1ノードに集約される');
  const boundary = boundaryNodes[0];
  const edgesToBoundary = g.edges.filter((e) => e.to === boundary.id);
  assert.ok(edgesToBoundary.length >= 2, `複数の呼び出し元から同一境界ノードへエッジが張られる(実際: ${edgesToBoundary.length})`);
  const callers = new Set(edgesToBoundary.map((e) => e.from));
  assert.ok(callers.has(byName(g, 'getUser').id));
  assert.ok(callers.has(byName(g, 'formatName').id));
});

test('kinds: class/method/arrow/module の kind 写像が Call Hierarchy 実物で検証される', () => {
  // kinds fixture: core() を対象に BFS すると
  //   上流: arrowCaller(const arrow 関数。CH 自体は kind='function' を返すため AST 上書きが必須)
  //         module(トップレベルの core() 呼び出し。CH は呼び出し元をファイル自身として返す)
  //   下流: format(Formatter クラスのメソッド)、Formatter(new Formatter() の呼び出し先としてのクラス)
  const g = graphFor('kinds', 'core');

  const arrowNode = byName(g, 'arrowCaller');
  assert.ok(arrowNode, 'arrowCaller が上流ノードとして検出される');
  assert.equal(arrowNode.kind, 'arrow');
  assert.equal(arrowNode.upstreamDistance, 1);

  const moduleNode = g.nodes.find((n) => n.kind === 'module');
  assert.ok(moduleNode, 'モジュールノード(トップレベル呼び出し)が検出される');
  assert.equal(moduleNode.upstreamDistance, 1);
  assert.equal(typeof moduleNode.codeTruncated, 'boolean');
  assert.ok(moduleNode.code.length > 0);
  // ±10 行抜粋: fixture 自体が16行未満なのでファイル全体が収まる
  assert.ok(moduleNode.endLine - moduleNode.startLine <= 21);

  const methodNode = byName(g, 'format');
  assert.ok(methodNode, 'format メソッドが下流ノードとして検出される');
  assert.equal(methodNode.kind, 'method');
  assert.equal(methodNode.containerName, 'Formatter');
  assert.equal(methodNode.downstreamDistance, 1);

  const classNode = byName(g, 'Formatter');
  assert.ok(classNode, 'Formatter クラスが下流ノードとして検出される(new 呼び出し先)');
  assert.equal(classNode.kind, 'class');
  assert.equal(classNode.downstreamDistance, 1);
});
