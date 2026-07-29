import path from 'node:path';
import { collectDeclarations } from './target-resolver.mjs';
import { classifySymbolFile } from './symbol-classifier.mjs';

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

/**
 * buildGraph と addCallbackEdges(Task 5)が共有する可変状態(ノード/エッジの Map、
 * 外部境界の重複排除、宣言 kind 解決など)をまとめたコンテキストを作る。
 * 返り値は graph オブジェクトの非列挙プロパティ `_ctx` として保持され、
 * addCallbackEdges から continueUpstream 経由で再利用される。
 */
function createGraphContext(ts, proj, opts) {
  const { projectRoot, maxNodes = 300, upstreamDepth = Infinity, downstreamDepth = Infinity } = opts;
  const nodes = new Map(); // id -> node
  const edges = new Map(); // `${from}->${to}#${kind}` -> edge (callLines をマージ)
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

  // kind をキーに含める: 同一ペア(from,to)が direct-call と callback-passed の
  // 両方を持つケース(例: 同じ関数がある行で直接呼び出しつつ、別の行で名前渡しもする)で
  // 一方がもう一方を上書き/吸収してしまわないようにする(edge-kind 衝突対策)。
  const upsertEdge = (from, to, kind, lines) => {
    const key = `${from}->${to}#${kind}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = { from, to, kind, callLines: [] };
      edges.set(key, edge);
    }
    edge.callLines = [...new Set([...edge.callLines, ...lines])].sort((a, b) => a - b);
  };

  return {
    projectRoot,
    maxNodes,
    upstreamDepth,
    downstreamDepth,
    nodes,
    edges,
    extNodesByKey,
    declKinds,
    sourceFileOf,
    prepare,
    idOf,
    kindOf,
    itemToNode,
    hasNode,
    upsertEdge,
    visitedUp: new Set(),
    visitedDown: new Set(),
    truncation: null,
  };
}

/** ctx (Map ベースの可変状態) の内容を graph (配列ベースの公開表現)に反映する */
export function syncGraph(graph) {
  const ctx = graph._ctx;
  if (ctx.truncation) {
    ctx.truncation.upstreamCount = [...ctx.nodes.values()].filter((n) => n.upstreamDistance != null && n.upstreamDistance > 0).length;
    ctx.truncation.downstreamCount = [...ctx.nodes.values()].filter((n) => n.downstreamDistance != null && n.downstreamDistance > 0).length;
  }
  graph.nodes = [...ctx.nodes.values()];
  graph.edges = [...ctx.edges.values()];
  graph.truncation = ctx.truncation;
  return graph;
}

/**
 * 片方向(up/down)1ステップ分の Call Hierarchy 展開。buildGraph の交互消費ループと
 * continueUpstream の両方から呼ばれる共有ロジック。queue に新規ノードを積み、
 * ctx.nodes/edges/truncation を直接変更する。
 */
function stepDirection(ts, proj, ctx, direction, entry, queue) {
  const { node, item, depth } = entry;
  const limit = direction === 'up' ? ctx.upstreamDepth : ctx.downstreamDepth;
  if (depth >= limit || !node.internal) return;
  const calls =
    direction === 'up'
      ? proj.service.provideCallHierarchyIncomingCalls(item.file, item.selectionSpan.start)
      : proj.service.provideCallHierarchyOutgoingCalls(item.file, item.selectionSpan.start);
  const visited = direction === 'up' ? ctx.visitedUp : ctx.visitedDown;
  for (const call of calls ?? []) {
    const peerItem = direction === 'up' ? call.from : call.to;
    // TS 標準ライブラリ / Node 組み込みはノード化しない。maxNodes チェックより前に
    // 弾くことで、stdlib が予算を消費したり truncation.frontier を汚したりしない
    // (誤った「打ち切られた」案内を防ぐ)。
    if (classifySymbolFile(proj.program, peerItem.file) === 'stdlib') continue;
    if (ctx.nodes.size >= ctx.maxNodes && !ctx.hasNode(peerItem)) {
      ctx.truncation ??= { reason: 'max-nodes', frontier: [] };
      ctx.truncation.frontier.push(peerItem.name);
      continue;
    }
    const peer = ctx.itemToNode(peerItem, call.fromSpans[0]);
    const lineSourceFile = ctx.sourceFileOf(direction === 'up' ? peerItem.file : item.file);
    const lines = lineSourceFile ? call.fromSpans.map((s) => lineOf(lineSourceFile, s.start)) : [];
    const [from, to] = direction === 'up' ? [peer.id, node.id] : [node.id, peer.id];
    ctx.upsertEdge(from, to, 'direct-call', lines);
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
}

/**
 * 上流方向(呼び出し元)の Call Hierarchy BFS を `startEntries` から再開/継続する。
 * addCallbackEdges が新規発見した「参照元の包含関数」ノードからの上流継続に使う。
 * buildGraph 自身の初回探索は maxNodes 予算の公平性(片方向の高 fan-out 対策)のため
 * 上下流を交互に1ステップずつ消費する専用ループを使うので、これは呼ばない。
 * graph._ctx に積まれた nodes/edges Map を直接変更し、最後に graph.nodes/edges/truncation を
 * 同期して返す。
 */
export function continueUpstream(ts, proj, graph, startEntries) {
  const ctx = graph._ctx;
  const queue = [...startEntries];
  for (const entry of queue) ctx.visitedUp.add(entry.node.id);
  while (queue.length) {
    stepDirection(ts, proj, ctx, 'up', queue.shift(), queue);
  }
  return syncGraph(graph);
}

export function buildGraph(ts, proj, targetDecl, opts) {
  const ctx = createGraphContext(ts, proj, opts);

  const targetItem = ctx.prepare(targetDecl.file, targetDecl.selectionStart);
  if (!targetItem) throw new Error('prepareCallHierarchy がターゲットを解決できませんでした');
  const targetNode = ctx.itemToNode(targetItem);
  targetNode.upstreamDistance = 0;
  targetNode.downstreamDistance = 0;

  const graph = { target: targetNode.id, truncation: null, nodes: [], edges: [] };
  Object.defineProperty(graph, '_ctx', { value: ctx, enumerable: false, writable: true, configurable: true });

  // 上下流の queue を交互に消費(スペック: 片方向の高 fan-out 対策。maxNodes 予算を
  // 一方向が独占しないようにする)
  const upQ = [{ node: targetNode, item: targetItem, depth: 0 }];
  const downQ = [{ node: targetNode, item: targetItem, depth: 0 }];
  ctx.visitedUp.add(targetNode.id);
  ctx.visitedDown.add(targetNode.id);
  while (upQ.length || downQ.length) {
    if (upQ.length) stepDirection(ts, proj, ctx, 'up', upQ.shift(), upQ);
    if (downQ.length) stepDirection(ts, proj, ctx, 'down', downQ.shift(), downQ);
  }

  return syncGraph(graph);
}
