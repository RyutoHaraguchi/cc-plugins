import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';
import { continueDownstream, syncGraph } from './graph-builder.mjs';

const SCAN_KINDS = new Set(['function', 'method', 'arrow']);

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * ソースファイル全体から CallExpression / NewExpression の引数位置に現れる
 * Identifier / PropertyAccessExpression を収集する。PropertyAccess は
 * getDefinitionAtPosition で正しく解決できるよう `.name` 側の Identifier を返す。
 * どのノードの本体に属するかの帰属はここでは行わない(呼び出し側が最内包含宣言で判定)。
 */
function collectArgRefs(ts, sourceFile) {
  const refs = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) {
        if (ts.isIdentifier(arg)) refs.push(arg);
        else if (ts.isPropertyAccessExpression(arg)) refs.push(arg.name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return refs;
}

/**
 * 下流側ノード(downstreamDistance を持つ内部関数様ノード)の本体から、
 * 引数位置に名前渡しされたリポ内定義関数を発見してノード化する後段パス。
 * エッジの網羅(上流方向)は後段の addCallbackEdges が新ノードも拾うため、
 * ここでは「発見 + 包含ノード→被渡し関数の callback-passed + 下流継続」のみ行う。
 * スペック: docs/superpowers/specs/2026-07-30-func-understand-downstream-callback-design.md
 */
export function addDownstreamCallbacks(ts, proj, graph, opts) {
  const { projectRoot } = opts;
  const ctx = graph._ctx;
  if (!ctx) throw new Error('addDownstreamCallbacks には buildGraph が返した graph(内部コンテキスト付き)が必要です');

  const decls = collectDeclarations(ts, proj).map((d) => ({ ...d, relFile: path.relative(projectRoot, d.file) }));
  const declByKey = new Map(decls.map((d) => [`${d.file}#${d.selectionStart}`, d]));
  const argRefsByFile = new Map(); // fileName -> collectArgRefs の結果(ファイル単位でキャッシュ)

  // 参照行を含む最内の関数様宣言の id を返す(callback-edges.mjs の findEnclosingDecl と同じ行ベース判定)
  const findEnclosingDeclId = (relFile, line) => {
    const candidates = decls.filter((d) => d.relFile === relFile && d.startLine <= line && line <= d.endLine);
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
    return `${candidates[0].relFile}#${candidates[0].selectionStart}`;
  };

  const isScannable = (node) => node.internal && SCAN_KINDS.has(node.kind) && node.downstreamDistance != null;

  const queue = [];
  const queued = new Set();
  const enqueue = (node) => {
    if (isScannable(node) && !queued.has(node.id)) {
      queued.add(node.id);
      queue.push(node);
    }
  };
  for (const node of ctx.nodes.values()) enqueue(node);

  while (queue.length) {
    const node = queue.shift();

    const sf = proj.program.getSourceFile(node._selection.file);
    if (!sf) continue;
    if (!argRefsByFile.has(sf.fileName)) argRefsByFile.set(sf.fileName, collectArgRefs(ts, sf));

    for (const refIdent of argRefsByFile.get(sf.fileName)) {
      const refPos = refIdent.getStart(sf);
      const refLine = lineOf(sf, refPos);
      // このノード自身の本体内の参照だけを扱う(ネストした名前付き関数内の参照は、
      // その関数がノード化されてスキャンされるときに扱う)
      if (findEnclosingDeclId(node.file, refLine) !== node.id) continue;

      const defs = proj.service.getDefinitionAtPosition(sf.fileName, refPos) ?? [];
      for (const def of defs) {
        const decl = declByKey.get(`${def.fileName}#${def.textSpan.start}`);
        if (!decl) continue; // リポ内の関数様宣言に解決できない(パラメータ・変数・外部・stdlib 等)

        const calleeId = `${decl.relFile}#${decl.selectionStart}`;

        // direct-call との二重計上防止: 同じ from→to の direct-call が同一行を記録済みならスキップ
        // (items.map(utils.fmt) のような PropertyAccess は outgoing calls が既に検出している)
        const dc = ctx.edges.get(`${node.id}->${calleeId}#direct-call`);
        if (dc && dc.callLines.includes(refLine)) continue;

        const item = ctx.prepare(decl.file, decl.selectionStart);
        if (!item) continue;
        const calleeNode = ctx.itemToNode(item);

        ctx.upsertEdge(node.id, calleeNode.id, 'callback-passed', [refLine]);

        // 未探索(downstreamDistance 未設定)なら距離を付与して下流を開き、自身の本体もスキャン対象に加える
        if (calleeNode.internal && calleeNode.downstreamDistance == null) {
          calleeNode.downstreamDistance = node.downstreamDistance + 1;
          continueDownstream(ts, proj, graph, [{ node: calleeNode, item, depth: calleeNode.downstreamDistance }]);
          for (const n of ctx.nodes.values()) enqueue(n);
        }
      }
    }
  }

  return syncGraph(graph);
}
