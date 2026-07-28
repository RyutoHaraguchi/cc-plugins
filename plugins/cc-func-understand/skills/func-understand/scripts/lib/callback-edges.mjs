import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';
import { continueUpstream, syncGraph } from './graph-builder.mjs';

const CALLBACK_SOURCE_KINDS = new Set(['function', 'method', 'arrow']);

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** pos を含む最も深いノード(getTouchingToken 相当)を再帰探索で求める */
function findNodeAt(ts, sourceFile, pos) {
  let result = null;
  const visit = (node) => {
    if (pos < node.getStart(sourceFile) || pos >= node.getEnd()) return;
    result = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/** 参照位置の祖先に ImportDeclaration/ExportDeclaration があるか */
function isInImportOrExport(ts, node) {
  for (let n = node; n; n = n.parent) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return true;
  }
  return false;
}

/**
 * 参照位置の Identifier(または PropertyAccessExpression チェーン)が
 * 親 CallExpression の呼び出し式(.expression)そのものであるかを判定する。
 * true なら「直接呼び出し」であり Call Hierarchy 側で既に検出されているはずなので除外対象。
 */
function isCallExpressionCallee(ts, sourceFile, refStart) {
  const node = findNodeAt(ts, sourceFile, refStart);
  if (!node) return false;
  let callee = node;
  while (callee.parent && ts.isPropertyAccessExpression(callee.parent)) callee = callee.parent;
  return Boolean(callee.parent && ts.isCallExpression(callee.parent) && callee.parent.expression === callee);
}

function isCallbackSourceNode(node) {
  return node.internal && CALLBACK_SOURCE_KINDS.has(node.kind);
}

/** ファイル全体を表す擬似 CallHierarchyItem(module ノード新設用)。TS が返す実物と同じ形にする。 */
function moduleItem(sourceFile) {
  return {
    file: sourceFile.fileName,
    kind: 'module',
    kindModifiers: '',
    name: sourceFile.fileName,
    span: { start: 0, length: sourceFile.text.length },
    selectionSpan: { start: 0, length: 0 },
  };
}

export function addCallbackEdges(ts, proj, graph, opts) {
  const { projectRoot } = opts;
  const ctx = graph._ctx;
  if (!ctx) throw new Error('addCallbackEdges には buildGraph が返した graph(内部コンテキスト付き)が必要です');

  const decls = collectDeclarations(ts, proj).map((d) => ({ ...d, relFile: path.relative(projectRoot, d.file) }));

  // 参照位置を含む最内の関数様宣言を collectDeclarations の行範囲で逆引きする
  const findEnclosingDecl = (sourceFile, refPos) => {
    const line = lineOf(sourceFile, refPos);
    const relFile = path.relative(projectRoot, sourceFile.fileName);
    const candidates = decls.filter((d) => d.relFile === relFile && d.startLine <= line && line <= d.endLine);
    if (!candidates.length) return null;
    // 最内(範囲が最も狭い宣言)を選ぶ
    candidates.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
    return candidates[0];
  };

  // 既存 direct-call エッジと同一行(呼び出し元ファイル基準)の集合。二重計上防止用。
  const directCallMarkers = () => {
    const markers = new Set();
    for (const edge of ctx.edges.values()) {
      if (edge.kind !== 'direct-call') continue;
      const fromNode = ctx.nodes.get(edge.from);
      if (!fromNode || !fromNode.internal) continue;
      const absFile = path.resolve(projectRoot, fromNode.file);
      for (const line of edge.callLines) markers.add(`${absFile}::${line}`);
    }
    return markers;
  };

  const queued = new Set();
  const queue = [];
  const enqueue = (node) => {
    if (isCallbackSourceNode(node) && !queued.has(node.id)) {
      queued.add(node.id);
      queue.push(node);
    }
  };
  for (const node of ctx.nodes.values()) enqueue(node);

  const processed = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (processed.has(node.id)) continue;
    processed.add(node.id);

    const referenced = proj.service.findReferences(node._selection.file, node._selection.start) ?? [];
    const markers = directCallMarkers();

    for (const group of referenced) {
      for (const ref of group.references) {
        if (ref.isDefinition) continue;

        const refSf = proj.program.getSourceFile(ref.fileName);
        if (!refSf) continue;

        const refNode = findNodeAt(ts, refSf, ref.textSpan.start);
        if (!refNode) continue;
        if (isInImportOrExport(ts, refNode)) continue;
        if (isCallExpressionCallee(ts, refSf, ref.textSpan.start)) continue;

        const refLine = lineOf(refSf, ref.textSpan.start);
        if (markers.has(`${ref.fileName}::${refLine}`)) continue;

        const enclosing = findEnclosingDecl(refSf, ref.textSpan.start);
        const enclosingId = enclosing ? `${enclosing.relFile}#${enclosing.selectionStart}` : `${path.relative(projectRoot, refSf.fileName)}#0`;

        const alreadyExists = ctx.nodes.has(enclosingId);
        if (!alreadyExists && ctx.nodes.size >= ctx.maxNodes) {
          ctx.truncation ??= { reason: 'max-nodes', frontier: [] };
          ctx.truncation.frontier.push(enclosing ? enclosing.name : path.relative(projectRoot, refSf.fileName));
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

        // 参照されたノードの upstreamDistance + 1(spec)。参照されたノードが下流専用で
        // upstreamDistance が未設定(null)の場合でも、callback-passed で新たに発見された
        // from ノードは「ここから上流に辿れる」ことが確定するので 0 起点として扱う。
        if (!alreadyExists && fromNode.upstreamDistance == null) {
          fromNode.upstreamDistance = (node.upstreamDistance ?? 0) + 1;
        }

        ctx.upsertEdge(fromNode.id, node.id, 'callback-passed', [refLine]);

        if (!alreadyExists) {
          enqueue(fromNode);
          if (fromItem && fromNode.internal) {
            continueUpstream(ts, proj, graph, [{ node: fromNode, item: fromItem, depth: fromNode.upstreamDistance ?? 0 }], opts);
            for (const n of ctx.nodes.values()) enqueue(n);
          }
        }
      }
    }
  }

  return syncGraph(graph);
}
