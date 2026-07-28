import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';

const MAX_CODE_BYTES = 16 * 1024;
const MODULE_EXCERPT_LINES = 10;

function truncateCode(text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_CODE_BYTES) return { code: text, codeTruncated: false };
  // バイト単位で安全に切る(マルチバイト文字の途中で切れないよう Buffer 経由で丸める)
  let buf = Buffer.from(text, 'utf8').subarray(0, MAX_CODE_BYTES);
  let sliced = buf.toString('utf8');
  // 末尾が不完全なマルチバイト文字になった場合、置換文字が出る可能性があるので
  // decode 後に再エンコードしてサイズが超過しないことだけ保証する
  while (Buffer.byteLength(sliced, 'utf8') > MAX_CODE_BYTES) {
    sliced = sliced.slice(0, -1);
  }
  return { code: sliced, codeTruncated: true };
}

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

export function buildGraph(ts, proj, targetDecl, opts) {
  const { projectRoot, maxNodes = 300, upstreamDepth = Infinity, downstreamDepth = Infinity } = opts;
  const nodes = new Map(); // id -> node
  const edges = new Map(); // `${from}->${to}` -> edge (callLines をマージ)
  let extSeq = 0;
  // 外部境界のシンボル単位重複排除用: `${解決先ファイルパス}::${シンボル名}` -> 既存ノード
  const extNodesByKey = new Map();
  // arrow 上書き判定用: `${file}#${selectionStart}` -> kind
  const declKinds = new Map(collectDeclarations(ts, proj).map((d) => [`${d.file}#${d.selectionStart}`, d.kind]));

  const sourceFileOf = (file) => proj.program.getSourceFile(file);

  const prepare = (file, pos) => {
    const item = proj.service.prepareCallHierarchy(file, pos);
    if (!item) return null;
    return Array.isArray(item) ? item[0] : item;
  };

  const idOf = (item) => {
    if (proj.isInternal(item.file)) {
      const relFile = path.relative(projectRoot, item.file);
      return `${relFile}#${item.selectionSpan.start}`;
    }
    return null; // 外部境界は呼び出し側で連番採番するため id を事前確定できない
  };

  const kindOf = (item) => {
    if (item.kind === ts.ScriptElementKind.moduleElement) return 'module';
    if (item.kind === ts.ScriptElementKind.classElement) return 'class';
    if (item.kind === ts.ScriptElementKind.memberFunctionElement) return 'method';
    const declKind = declKinds.get(`${item.file}#${item.selectionSpan.start}`);
    return declKind === 'arrow' ? 'arrow' : 'function';
  };

  // excerptSpan: 呼び出し箇所の TextSpan(module ノードの周辺抜粋に使う)
  const itemToNode = (item, excerptSpan) => {
    const internal = proj.isInternal(item.file);
    if (!internal) {
      // 同一の解決先ファイル+シンボル名は1ノードに集約する(呼び出し元が複数あっても境界ノードは1個)
      const extKey = `${item.file}::${item.name}`;
      const existingExt = extNodesByKey.get(extKey);
      if (existingExt) return existingExt;
      const id = `${path.basename(item.file)}#ext-${extSeq++}`;
      const node = { id, name: item.name, kind: 'external-boundary', internal: false };
      nodes.set(id, node);
      extNodesByKey.set(extKey, node);
      return node;
    }

    const id = idOf(item);
    const existing = nodes.get(id);
    if (existing) return existing;

    const kind = kindOf(item);
    const sf = sourceFileOf(item.file);
    const relFile = path.relative(projectRoot, item.file);
    let startLine, endLine, code, codeTruncated;

    if (kind === 'module') {
      // module ノード: 呼び出し箇所(excerptSpan)の周辺 ±10 行を抜粋
      const around = excerptSpan ? sf.getLineAndCharacterOfPosition(excerptSpan.start).line : 0;
      const fromLine = Math.max(0, around - MODULE_EXCERPT_LINES);
      const toLine = Math.min(sf.getLineStarts().length - 1, around + MODULE_EXCERPT_LINES);
      const lineStarts = sf.getLineStarts();
      const startPos = lineStarts[fromLine];
      const endPos = toLine + 1 < lineStarts.length ? lineStarts[toLine + 1] : sf.text.length;
      startLine = fromLine + 1;
      endLine = toLine + 1;
      ({ code, codeTruncated } = truncateCode(sf.text.slice(startPos, endPos)));
    } else {
      const span = item.span ?? item.selectionSpan;
      const start = sf.getLineAndCharacterOfPosition(span.start);
      const end = sf.getLineAndCharacterOfPosition(span.start + span.length);
      startLine = start.line + 1;
      endLine = end.line + 1;
      ({ code, codeTruncated } = truncateCode(sf.text.slice(span.start, span.start + span.length)));
    }

    const node = {
      id,
      // module kind の item.name は TS が絶対パスをそのまま返す(観測済み)。
      // 他ノードとの整合(file は相対パス)と絶対パス非漏洩のため relFile に差し替える。
      name: kind === 'module' ? relFile : item.name,
      containerName: item.containerName || undefined,
      kind,
      internal: true,
      file: relFile,
      startLine,
      endLine,
      code,
      codeTruncated,
      upstreamDistance: null,
      downstreamDistance: null,
      summary: null,
      _selection: { file: item.file, start: item.selectionSpan.start },
    };
    nodes.set(id, node);
    return node;
  };

  const hasNode = (item) => {
    if (!proj.isInternal(item.file)) return extNodesByKey.has(`${item.file}::${item.name}`); // 同一外部シンボルは既存扱い
    return nodes.has(idOf(item));
  };

  const upsertEdge = (from, to, kind, lines) => {
    const key = `${from}->${to}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = { from, to, kind, callLines: [] };
      edges.set(key, edge);
    }
    edge.callLines = [...new Set([...edge.callLines, ...lines])].sort((a, b) => a - b);
  };

  const targetItem = prepare(targetDecl.file, targetDecl.selectionStart);
  if (!targetItem) throw new Error('prepareCallHierarchy がターゲットを解決できませんでした');
  const targetNode = itemToNode(targetItem);
  targetNode.upstreamDistance = 0;
  targetNode.downstreamDistance = 0;

  // 上下流の queue を交互に消費(スペック: 片方向の高 fan-out 対策)
  const upQ = [{ node: targetNode, item: targetItem, depth: 0 }];
  const downQ = [{ node: targetNode, item: targetItem, depth: 0 }];
  const visitedUp = new Set([targetNode.id]);
  const visitedDown = new Set([targetNode.id]);
  let truncated = null;

  const step = (queue, direction) => {
    const { node, item, depth } = queue.shift();
    const limit = direction === 'up' ? upstreamDepth : downstreamDepth;
    if (depth >= limit || !node.internal) return;
    const calls =
      direction === 'up'
        ? proj.service.provideCallHierarchyIncomingCalls(item.file, item.selectionSpan.start)
        : proj.service.provideCallHierarchyOutgoingCalls(item.file, item.selectionSpan.start);
    for (const call of calls ?? []) {
      const peerItem = direction === 'up' ? call.from : call.to;
      if (nodes.size >= maxNodes && !hasNode(peerItem)) {
        truncated ??= { reason: 'max-nodes', frontier: [] };
        truncated.frontier.push(peerItem.name);
        continue;
      }
      const peer = itemToNode(peerItem, call.fromSpans[0]);
      const lineSourceFile = sourceFileOf(direction === 'up' ? peerItem.file : item.file);
      const lines = lineSourceFile ? call.fromSpans.map((s) => lineOf(lineSourceFile, s.start)) : [];
      const [from, to] = direction === 'up' ? [peer.id, node.id] : [node.id, peer.id];
      upsertEdge(from, to, 'direct-call', lines);
      const visited = direction === 'up' ? visitedUp : visitedDown;
      if (!visited.has(peer.id)) {
        visited.add(peer.id);
        if (peer.internal) {
          // 外部境界ノードは { id, name, kind, internal:false } の4フィールドのみを保持する
          // (仕様の interface 節)。distance は内部ノードにのみ付与する。
          const key = direction === 'up' ? 'upstreamDistance' : 'downstreamDistance';
          if (peer[key] == null) peer[key] = depth + 1;
          queue.push({ node: peer, item: peerItem, depth: depth + 1 });
        }
      }
    }
  };

  while (upQ.length || downQ.length) {
    if (upQ.length) step(upQ, 'up');
    if (downQ.length) step(downQ, 'down');
  }

  if (truncated) {
    truncated.upstreamCount = [...nodes.values()].filter((n) => n.upstreamDistance != null && n.upstreamDistance > 0).length;
    truncated.downstreamCount = [...nodes.values()].filter((n) => n.downstreamDistance != null && n.downstreamDistance > 0).length;
  }

  return {
    target: targetNode.id,
    truncation: truncated,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
