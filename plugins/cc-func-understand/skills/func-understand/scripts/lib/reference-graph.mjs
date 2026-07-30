import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';
import { createGraphContext, syncGraph, continueUpstream, truncateCode } from './graph-builder.mjs';
import { findNodeAt, isInImportOrExport, moduleItem } from './callback-edges.mjs';

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * 参照グラフモード(スペック: docs/superpowers/specs/2026-07-30-func-understand-reference-graph-design.md)。
 * モジュールレベルの変数/enum を起点に、findReferences で「読んでいる関数」へ
 * reads エッジを張り、そこから既存の上流 BFS(continueUpstream)を継続する。
 * 下流方向は探索しない(変数は呼び出さないため片方向グラフ)。
 * targetDecl は collectModuleValueDeclarations の戻り値(relFile 埋め済み)。
 */
export function buildReferenceGraph(ts, proj, targetDecl, opts) {
  const { projectRoot } = opts;
  const ctx = createGraphContext(ts, proj, opts);

  // 起点(変数/enum)ノード。CallHierarchyItem を経由できないため手動で構築する。
  // id 形式・フィールドは既存の内部ノード規約(itemToNode)に合わせる。
  const sf = proj.program.getSourceFile(targetDecl.file);
  const relFile = path.relative(projectRoot, targetDecl.file);
  const targetId = `${relFile}#${targetDecl.selectionStart}`;
  const lineStarts = sf.getLineStarts();
  const startPos = lineStarts[targetDecl.startLine - 1];
  const endPos = targetDecl.endLine < lineStarts.length ? lineStarts[targetDecl.endLine] : sf.text.length;
  const { code, codeTruncated } = truncateCode(sf.text.slice(startPos, endPos));
  const targetNode = {
    id: targetId,
    name: targetDecl.name,
    kind: targetDecl.kind, // 'variable' | 'enum'
    internal: true,
    file: relFile,
    startLine: targetDecl.startLine,
    endLine: targetDecl.endLine,
    code,
    codeTruncated,
    upstreamDistance: 0,
    downstreamDistance: null,
    summary: null,
    _selection: { file: targetDecl.file, start: targetDecl.selectionStart },
  };
  ctx.nodes.set(targetId, targetNode);

  const graph = { target: targetId, truncation: null, nodes: [], edges: [] };
  Object.defineProperty(graph, '_ctx', { value: ctx, enumerable: false, writable: true, configurable: true });

  // upstreamDepth 0 は「起点のみ」(関数グラフの深さ規約と同じ)
  if (ctx.upstreamDepth < 1) return syncGraph(graph);

  // 参照位置を含む最内の関数様宣言の逆引き(callback-edges の findEnclosingDecl と同じ行ベース判定)
  const decls = collectDeclarations(ts, proj).map((d) => ({ ...d, relFile: path.relative(projectRoot, d.file) }));
  const findEnclosingDecl = (refSf, refPos) => {
    const line = lineOf(refSf, refPos);
    const rel = path.relative(projectRoot, refSf.fileName);
    const candidates = decls.filter((d) => d.relFile === rel && d.startLine <= line && line <= d.endLine);
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
    return candidates[0];
  };

  const upstreamEntries = [];
  const referenced = proj.service.findReferences(targetDecl.file, targetDecl.selectionStart) ?? [];
  for (const group of referenced) {
    for (const ref of group.references) {
      if (ref.isDefinition) continue;
      const refSf = proj.program.getSourceFile(ref.fileName);
      if (!refSf) continue;
      if (ctx.isFileExcluded(ref.fileName)) continue;
      const refNode = findNodeAt(ts, refSf, ref.textSpan.start);
      if (!refNode) continue;
      if (isInImportOrExport(ts, refNode)) continue;

      const refLine = lineOf(refSf, ref.textSpan.start);
      const enclosing = findEnclosingDecl(refSf, ref.textSpan.start);
      const enclosingId = enclosing
        ? `${enclosing.relFile}#${enclosing.selectionStart}`
        : `${path.relative(projectRoot, refSf.fileName)}#0`;

      const alreadyExists = ctx.nodes.has(enclosingId);
      if (!alreadyExists && ctx.nodes.size >= ctx.maxNodes) {
        ctx.truncation ??= { reason: 'max-nodes', frontier: [] };
        const frontierName = enclosing ? enclosing.name : path.relative(projectRoot, refSf.fileName);
        if (!ctx.truncation.frontier.includes(frontierName)) ctx.truncation.frontier.push(frontierName);
        continue;
      }

      let fromNode;
      let fromItem;
      if (alreadyExists) {
        fromNode = ctx.nodes.get(enclosingId);
      } else if (enclosing) {
        fromItem = ctx.prepare(enclosing.file, enclosing.selectionStart);
        if (!fromItem) continue;
        fromNode = ctx.itemToNode(fromItem);
      } else {
        fromItem = moduleItem(refSf);
        fromNode = ctx.itemToNode(fromItem, ref.textSpan);
      }

      if (fromNode.upstreamDistance == null) fromNode.upstreamDistance = 1;
      ctx.upsertEdge(fromNode.id, targetId, 'reads', [refLine]);

      if (!alreadyExists && fromItem && fromNode.internal) {
        upstreamEntries.push({ node: fromNode, item: fromItem, depth: 1 });
      }
    }
  }

  continueUpstream(ts, proj, graph, upstreamEntries);
  return syncGraph(graph);
}
