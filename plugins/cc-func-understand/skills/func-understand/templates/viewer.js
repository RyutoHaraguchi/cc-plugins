'use strict';

// ============================================================
// 1. データロード
// ============================================================
const graph = JSON.parse(document.getElementById('graph-data').textContent);

// 同じ from->to 組でも kind 違い(direct-call / callback-passed)で複数エッジがあり得るため、
// 配列インデックスを使った安定な一意 id を各エッジに付与しておく(cytoscape 要素 id として使う)。
graph.edges.forEach((e, i) => {
  e._id = `e${i}`;
});

const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
const outEdges = new Map(); // from -> edge[]
const inEdges = new Map(); // to -> edge[]
for (const e of graph.edges) {
  if (!outEdges.has(e.from)) outEdges.set(e.from, []);
  outEdges.get(e.from).push(e);
  if (!inEdges.has(e.to)) inEdges.set(e.to, []);
  inEdges.get(e.to).push(e);
}

// ============================================================
// 2. 可視状態管理
// ============================================================
// 初期表示: target 本体 + 距離1(上流・下流それぞれ最大20件)のノード。
// external-boundary ノードは upstreamDistance/downstreamDistance を持たない(スキーマ上
// id/name/kind/internal のみ)ため、距離判定だけでは target と直結していても拾えない。
// 「対象関数 ±1 ホップ」は distance ベースの内部ノードだけでなく target とエッジで直結する
// external-boundary ノードも含む、と解釈し、上限20件は内部ノードと合算でカウントする。
// 超過分は非表示のまま(集約プレースホルダは作らず、展開ボタンの +N 表示で代替する)。
function directExternalNeighborIds(dir) {
  const edges = dir === 'up' ? (inEdges.get(graph.target) ?? []) : (outEdges.get(graph.target) ?? []);
  const ids = new Set();
  for (const e of edges) {
    const neighborId = dir === 'up' ? e.from : e.to;
    const n = nodesById.get(neighborId);
    if (n && n.kind === 'external-boundary') ids.add(neighborId);
  }
  return [...ids];
}

const visible = new Set([graph.target]);
{
  const upstreamIds = graph.nodes.filter((n) => n.upstreamDistance === 1).map((n) => n.id);
  const downstreamIds = graph.nodes.filter((n) => n.downstreamDistance === 1).map((n) => n.id);
  const upstream1 = [...new Set([...upstreamIds, ...directExternalNeighborIds('up')])].slice(0, 20);
  const downstream1 = [...new Set([...downstreamIds, ...directExternalNeighborIds('down')])].slice(0, 20);
  for (const id of upstream1) visible.add(id);
  for (const id of downstream1) visible.add(id);
}

// ============================================================
// 3. 描画
// ============================================================
let cy = null;

// 選択時デクラッタ: タップ選択したノードの1ホップ近傍以外を減光する。
// programmatic な showDetail(初期表示・展開ボタン)では発動させず、
// ユーザーの明示的なタップ操作でのみ dimFocus を設定する。
let dimFocus = null;

function applyDim() {
  if (!cy) return;
  cy.elements('.dimmed').removeClass('dimmed');
  if (dimFocus === null) return;
  const focus = cy.getElementById(dimFocus);
  if (focus.length === 0) {
    // 選択ノードが非可視になった(再構築で消えた)場合は解除する
    dimFocus = null;
    return;
  }
  // 経路ハイライト中はエッジ(.on-path)だけでなく経路上のノードも減光対象から外す。
  // 外さないと 1 ホップ圏外の経路上ノードが減光され「明るい経路が暗いノードを貫く」見た目になる。
  const onPathEdges = cy.edges('.on-path');
  cy.elements()
    .not(focus.closedNeighborhood())
    .not(onPathEdges)
    .not(onPathEdges.connectedNodes())
    .addClass('dimmed');
}

// dagre へ渡すレイアウトパラメータ。cytoscape-dagre は値が undefined のオプションを
// setGraph に載せないため、ここで指定しない edgesep(20) / ranksep(50) / ranker は
// dagre 既定が効く。cytoscape-dagre 経由と同じ座標を得るには、この3つを渡さないことが条件。
const DAGRE_GRAPH_OPTS = { rankdir: 'LR', align: 'DL', nodesep: 20 };
const LAYOUT_PADDING = 30;

/**
 * dagre を直接呼んでレイアウトを計算する。
 *
 * cytoscape-dagre はノード座標しか読まず、dagre が計算したエッジ経路(`g.edge().points`)を
 * 捨てている。経路を使うために dagre を自前で回す。入力は cytoscape-dagre と同一に揃えて
 * あり、ノード座標は cytoscape-dagre 使用時と一致する(smoke テストで固定)。
 *
 * 自己ループ(直接再帰)は dagre がランク付けできないため渡さない。該当エッジは経路を持たず、
 * cytoscape 既定のループ描画に任せる。
 */
function runDagre() {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ ...DAGRE_GRAPH_OPTS });
  g.setDefaultEdgeLabel(() => ({}));
  cy.nodes().forEach((n) => {
    const d = n.layoutDimensions({ nodeDimensionsIncludeLabels: true });
    g.setNode(n.id(), { width: d.w, height: d.h });
  });
  cy.edges().forEach((e) => {
    const source = e.data('source');
    const target = e.data('target');
    if (source === target) return;
    g.setEdge(source, target, { minlen: 1, weight: 1 }, e.id());
  });
  dagre.layout(g);
  return g;
}

/** dagre の結果をノード位置に反映し、ビューポートを合わせる。 */
function applyDagreLayout(g) {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const d = g.node(n.id());
      if (d) n.position({ x: d.x, y: d.y });
    });
  });
  cy.fit(undefined, LAYOUT_PADDING);
}

/**
 * ランク列と列の間にある「ノードが存在しない縦帯」(ガター)を x 昇順で返す。
 *
 * dagre は同一ランクのノードを同じ rank 座標(rankdir=LR なら x)に中心揃えし、隣接ランクの
 * 間隔を (maxWidth_r + maxWidth_r+1)/2 + ranksep で取る。よって
 * [rank r のノード右端の最大値, rank r+1 のノード左端の最小値] には必ず ranksep 幅の空きがある。
 * dagre 自身もこの帯を edge label 用 dummy の置き場として使うので、経路点の一部はここに乗る。
 */
function computeGutters(g) {
  const ranks = new Map(); // rank 座標(x) -> ノード群の左端/右端
  for (const id of g.nodes()) {
    const d = g.node(id);
    if (!d) continue;
    const rank = ranks.get(d.x) ?? { left: Infinity, right: -Infinity };
    rank.left = Math.min(rank.left, d.x - d.width / 2);
    rank.right = Math.max(rank.right, d.x + d.width / 2);
    ranks.set(d.x, rank);
  }
  const xs = [...ranks.keys()].sort((a, b) => a - b);
  const gutters = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    gutters.push({ x1: ranks.get(xs[i]).right, x2: ranks.get(xs[i + 1]).left, turns: [] });
  }
  return gutters;
}

/** x を含むガターを返す(境界上も含む)。無ければ null。 */
function gutterAt(gutters, x) {
  return gutters.find((gutter) => x >= gutter.x1 && x <= gutter.x2) ?? null;
}

/**
 * ガター内で折れ点の x を散らす。
 *
 * 全てをガター中央に置くと、同じランクから出る垂直セグメントが同一 x に重なり、
 * 別々のエッジが 1 本に見えて呼び出し関係を誤読させる。行き先 y でソートしてから
 * 等間隔に割り当てると、垂直セグメント同士の交差も減る。
 */
function assignTurnXs(gutter) {
  if (gutter.turns.length === 0) return;
  gutter.turns.sort((a, b) => a.sortKey - b.sortKey || a.seq - b.seq);
  const step = (gutter.x2 - gutter.x1) / (gutter.turns.length + 1);
  gutter.turns.forEach((turn, i) => {
    turn.x = gutter.x1 + step * (i + 1);
  });
}

/**
 * 各エッジの経路を「レーン内の水平移動」と「ガター内の垂直移動」だけの直交ポリラインで求め、
 * edgeId -> 絶対座標の点列(始点=source 中心, 終点=target 中心) を返す。
 *
 * dagre はランクを跨ぐエッジに dummy node を挿入してレーン(ノードに当たらない水平帯)を
 * 確保するが、レーンへの出入りは斜め直線で、そこが何を横切るかは保証していない
 * (実測: 210 本中 84 本が他ノードを貫通し、その全てが両端の斜め区間由来)。
 * 斜めをガター内での直角折れに置き換えると、水平区間はレーン内・垂直区間はガター内に収まる。
 *
 * 自己ループは dagre に渡していないので経路を持たず、cytoscape 既定のループ描画に任せる。
 */
function computeRoutes(g) {
  const gutters = computeGutters(g);
  const routes = new Map();
  let seq = 0;

  cy.edges().forEach((e) => {
    const source = e.data('source');
    const target = e.data('target');
    if (source === target) return;
    const dagreEdge = g.edge({ v: source, w: target, name: e.id() });
    const src = g.node(source);
    const tgt = g.node(target);
    if (!dagreEdge || !src || !tgt) return;

    // dagre の points の両端はノード境界との交点。cytoscape 側が境界でクリップするため捨て、
    // 中間ランクに確保されたレーン上の点だけを使う。
    const lane = (dagreEdge.points ?? []).slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
    const raw = [{ x: src.x, y: src.y }, ...lane, { x: tgt.x, y: tgt.y }];

    const points = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const from = points[points.length - 1];
      const to = raw[i];
      if (from.x !== to.x && from.y !== to.y) {
        // dagre は edge label 用の dummy をランク列の間(=ガター)に置くため、斜めになる区間の
        // 少なくとも一方の端は必ずガターの中にある。そこで折れば垂直区間がガターに収まる。
        const gutter = gutterAt(gutters, to.x) ?? gutterAt(gutters, from.x);
        // x はガターごとの分散(assignTurnXs)で確定するため、2点で turn を共有する
        const turn = {
          x: gutter ? (gutter.x1 + gutter.x2) / 2 : (from.x + to.x) / 2,
          sortKey: to.y,
          seq: seq++,
        };
        if (gutter) gutter.turns.push(turn);
        points.push({ x: 0, y: from.y, turn });
        points.push({ x: 0, y: to.y, turn });
      }
      points.push(to);
    }
    routes.set(e.id(), points);
  });

  gutters.forEach(assignTurnXs);
  for (const points of routes.values()) {
    for (const p of points) {
      if (p.turn) p.x = p.turn.x;
    }
  }
  return routes;
}

/**
 * 絶対座標の経路を cytoscape の segment-weights / segment-distances に変換する。
 *
 * 基準線は A→B。weight は A→B 方向の比率、distance は左手系の符号付き垂直距離
 * (A→B が +x のとき distance>0 は +y 側。実測で確認)。
 */
function toSegments(points, a, b) {
  const inner = points.slice(1, -1);
  if (inner.length === 0) return null;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return null;
  const len = Math.sqrt(len2);
  const weights = [];
  const distances = [];
  for (const p of inner) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    weights.push((dx * vx + dy * vy) / len2);
    distances.push((vx * dy - vy * dx) / len);
  }
  return { weights, distances };
}

/**
 * 経路を cytoscape に適用する。
 *
 * segments の基準点 A/B は「source と target の中心を結ぶ直線が各ノード形状と交わる点」で、
 * 角丸矩形の丸みまで効くため自前計算は再現が難しい。weights=[0,1] / distances=[0,0] は
 * 定義上 A と B そのものになるので、一度それを設定して segmentPoints() から読み取る。
 */
function applyRoutes(routes) {
  cy.batch(() => {
    cy.edges().forEach((e) => {
      if (!routes.has(e.id())) return;
      e.style({ 'curve-style': 'segments', 'segment-weights': [0, 1], 'segment-distances': [0, 0] });
    });
  });

  const baselines = new Map();
  cy.edges().forEach((e) => {
    if (!routes.has(e.id())) return;
    const ends = e.segmentPoints();
    if (ends && ends.length === 2) baselines.set(e.id(), ends);
  });

  cy.batch(() => {
    cy.edges().forEach((e) => {
      const points = routes.get(e.id());
      if (!points) return;
      const ends = baselines.get(e.id());
      const seg = ends ? toSegments(points, ends[0], ends[1]) : null;
      if (seg) {
        e.style({
          'curve-style': 'segments',
          'segment-weights': seg.weights,
          'segment-distances': seg.distances,
        });
      } else {
        // 折れ点なし(水平一直線)や基準線が退化したケース
        e.style({ 'curve-style': 'straight' });
      }
      e.scratch('_route', points);
    });
  });
}

// 展開可能性の提示は詳細パネルの「上流/下流を展開 (+N)」ボタンが担う。
// ラベル上のバッジ表示は brief 外の追加であり、全可視ノード×毎 render で expandable() を
// 余分に呼ぶコストと解釈リスクだけが残るため設けない(YAGNI)。
function nodeLabel(id) {
  const n = nodesById.get(id);
  return n.containerName ? `${n.containerName}.${n.name}` : n.name;
}

function buildElements() {
  const elements = [];
  for (const id of visible) {
    const n = nodesById.get(id);
    if (!n) continue;
    const classes = [];
    if (id === graph.target) classes.push('is-target');
    if (n.kind === 'external-boundary') classes.push('boundary');
    if (n.kind === 'module') classes.push('is-module');
    elements.push({
      group: 'nodes',
      data: { id: n.id, kind: n.kind, label: nodeLabel(id) },
      classes: classes.join(' '),
    });
  }
  for (const e of graph.edges) {
    if (visible.has(e.from) && visible.has(e.to)) {
      elements.push({
        group: 'edges',
        data: { id: e._id, source: e.from, target: e.to, kind: e.kind },
        classes: e.kind === 'callback-passed' ? 'callback' : e.kind === 'reads' ? 'reads' : '',
      });
    }
  }
  return elements;
}

const CY_STYLE = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': 10,
      color: '#c9d1d9',
      'background-color': '#30363d',
      'border-width': 1,
      'border-color': '#484f58',
      'text-valign': 'center',
      'text-halign': 'center',
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: '10px',
      'text-wrap': 'wrap',
      'text-max-width': '220px',
    },
  },
  {
    selector: 'node[kind="module"]',
    style: { 'background-color': '#21262d', color: '#8b949e', 'font-style': 'italic' },
  },
  {
    selector: 'node[kind="external-boundary"]',
    style: { 'border-style': 'dotted', 'background-color': '#161b22', color: '#8b949e' },
  },
  {
    selector: 'node.is-target',
    style: {
      'background-color': '#1f6feb',
      color: '#ffffff',
      'font-weight': 'bold',
      'font-size': 12,
      'border-width': 2,
      'border-color': '#58a6ff',
    },
  },
  {
    selector: 'node[kind="variable"], node[kind="enum"]',
    style: { 'border-color': '#d29922', 'border-width': 2, 'border-style': 'double' },
  },
  {
    selector: 'node.search-hit',
    style: { 'border-color': '#d29922', 'border-width': 4 },
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#484f58',
      'target-arrow-color': '#484f58',
      'target-arrow-shape': 'triangle',
      // curve-style はエッジごとに applyRoutes() が segments / straight を設定する。
      // ここに残るのは経路を持たないエッジ(自己ループ)だけで、cytoscape 既定の bezier で描く。
      'font-size': 9,
      color: '#8b949e',
    },
  },
  {
    selector: 'edge.callback',
    style: { 'line-style': 'dashed', label: 'callback' },
  },
  {
    selector: 'edge.reads',
    style: {
      'line-style': 'dotted',
      label: 'reads',
      'line-color': '#a371f7',
      'target-arrow-color': '#a371f7',
    },
  },
  {
    selector: 'edge.on-path',
    style: {
      width: 4,
      'line-color': '#3fb950',
      'target-arrow-color': '#3fb950',
      'z-index': 999,
    },
  },
  {
    selector: 'node.dimmed',
    style: { opacity: 0.15 },
  },
  {
    selector: 'edge.dimmed',
    style: { opacity: 0.15 },
  },
];

function initCy() {
  cy = cytoscape({
    container: document.getElementById('graph'),
    elements: [],
    style: CY_STYLE,
    wheelSensitivity: 0.2,
  });
  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id();
    dimFocus = id;
    applyDim();
    // ユーザーの明示的なタップでのみ自動オープンする(programmatic な showDetail では開かない)
    if (detailPanel.hidden) setPanelOpen(true);
    showDetail(id);
  });
  cy.on('tap', (evt) => {
    // 背景(キャンバス)タップで減光を解除する。詳細パネルは閉じない(#7 の範囲)。
    if (evt.target === cy) {
      dimFocus = null;
      applyDim();
    }
  });
  cy.on('dbltap', 'node', (evt) => {
    const id = evt.target.id();
    expand(id, 'up');
    expand(id, 'down');
    showDetail(id);
  });
}

function render() {
  if (!cy) return;
  const elements = buildElements();
  cy.elements().remove();
  cy.add(elements);
  const g = runDagre();
  applyDagreLayout(g);
  applyRoutes(computeRoutes(g));
  applyDim();
}

// ============================================================
// 4. 展開
// ============================================================
/** id から見て dir 側('up' = 呼び出し元 / 'down' = 呼び出し先)にある非表示ノード id の一覧。 */
function expandable(id, dir) {
  const edges = dir === 'up' ? (inEdges.get(id) ?? []) : (outEdges.get(id) ?? []);
  const seen = new Set();
  for (const e of edges) {
    const neighborId = dir === 'up' ? e.from : e.to;
    if (!visible.has(neighborId)) seen.add(neighborId);
  }
  return [...seen];
}

/** expandable() の先頭20件を可視化して再描画する。 */
function expand(id, dir) {
  const ids = expandable(id, dir).slice(0, 20);
  if (ids.length === 0) return;
  // render() は要素を全再構築するため on-path は黙って消える。select だけが選択状態のまま
  // 残ると UI が嘘をつくことになるので、展開前に経路ハイライトの状態も揃えてリセットする。
  clearOnPath();
  if (entrySelect) entrySelect.value = '';
  for (const nid of ids) visible.add(nid);
  render();
}

// ============================================================
// 5. 詳細パネル
// ============================================================
let detailEls = null;

function buildDetailSkeleton() {
  const detail = document.getElementById('detail');
  detail.textContent = '';

  const name = document.createElement('h2');
  name.className = 'detail-name';
  detail.appendChild(name);

  const kindLine = document.createElement('div');
  kindLine.className = 'detail-kind';
  detail.appendChild(kindLine);

  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.textContent = '(要約未生成)';
  detail.appendChild(summary);

  const loc = document.createElement('div');
  loc.className = 'loc';
  detail.appendChild(loc);

  const btnRow = document.createElement('div');
  btnRow.className = 'expand-buttons';
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'expand-up';
  upBtn.hidden = true;
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'expand-down';
  downBtn.hidden = true;
  btnRow.appendChild(upBtn);
  btnRow.appendChild(downBtn);
  detail.appendChild(btnRow);

  // 長大なコードは既定で先頭 CODE_PREVIEW_LINES 行だけ描画し、この行から全文へ展開する。
  const codeBar = document.createElement('div');
  codeBar.className = 'code-bar';
  codeBar.hidden = true;
  const codeNote = document.createElement('span');
  codeNote.className = 'code-note';
  const showAllBtn = document.createElement('button');
  showAllBtn.type = 'button';
  showAllBtn.className = 'show-all-code';
  codeBar.appendChild(codeNote);
  codeBar.appendChild(showAllBtn);
  detail.appendChild(codeBar);

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.appendChild(code);
  detail.appendChild(pre);

  return { detail, name, kindLine, summary, loc, upBtn, downBtn, codeBar, codeNote, showAllBtn, pre };
}

function languageClassFor(file) {
  if (!file) return null;
  if (/\.tsx?$/.test(file)) return 'language-typescript';
  if (/\.jsx?$/.test(file)) return 'language-javascript';
  return null;
}

// 1000 行級のノードを毎回フルにハイライトすると詳細パネルの切り替えが目に見えて重くなるため、
// 既定では先頭のみ描画する。全文は n.code に載っているので「全文を表示」で展開できる。
const CODE_PREVIEW_LINES = 200;

/**
 * 詳細パネルのコード欄を描画する。
 * showAll=false かつ CODE_PREVIEW_LINES 超のときのみ先頭を切り出し、
 * 残り行数と展開ボタンを code-bar に出す(切り出しは表示だけで、データは常に全文)。
 */
function renderCode(n, showAll) {
  const { codeBar, codeNote, showAllBtn, pre } = detailEls;
  const full = n.code ?? '';
  const lines = full === '' ? [] : full.split('\n');
  const isPreview = !showAll && lines.length > CODE_PREVIEW_LINES;
  const shown = isPreview ? lines.slice(0, CODE_PREVIEW_LINES).join('\n') : full;

  codeBar.hidden = lines.length <= CODE_PREVIEW_LINES;
  if (!codeBar.hidden) {
    codeNote.textContent = isPreview
      ? `先頭 ${CODE_PREVIEW_LINES} 行を表示中 (全 ${lines.length} 行)`
      : `全 ${lines.length} 行を表示中`;
    showAllBtn.hidden = !isPreview;
    showAllBtn.textContent = `全文を表示 (残り ${lines.length - CODE_PREVIEW_LINES} 行)`;
    showAllBtn.onclick = () => renderCode(n, true);
  }

  // hljs は同一 <code> 要素への再ハイライトを嫌う実装があるため、毎回新しい要素に差し替える。
  pre.textContent = '';
  const codeEl = document.createElement('code');
  const langClass = languageClassFor(n.file);
  if (langClass) codeEl.className = langClass;
  codeEl.textContent = full === '' ? '(コードなし: 外部/未解決の呼び出し)' : shown;
  pre.appendChild(codeEl);
  if (full !== '' && typeof hljs !== 'undefined') {
    hljs.highlightElement(codeEl);
  }
  // 展開時はコード欄の先頭から読み始められるようにする(前回のスクロール位置を持ち越さない)。
  pre.scrollTop = 0;
}

function showDetail(id) {
  const n = nodesById.get(id);
  if (!n || !detailEls) return;

  detailEls.name.textContent = n.containerName ? `${n.containerName}.${n.name}` : n.name;
  detailEls.kindLine.textContent = n.kind;
  detailEls.summary.textContent = n.summary ?? '(要約未生成)';
  detailEls.loc.textContent = n.file ? `${n.file}:${n.startLine ?? '?'}` : n.name;

  renderCode(n, false);

  const upCount = expandable(id, 'up').length;
  const downCount = expandable(id, 'down').length;

  detailEls.upBtn.hidden = upCount === 0;
  detailEls.upBtn.textContent = `上流を展開 (+${upCount})`;
  detailEls.upBtn.onclick = () => {
    expand(id, 'up');
    showDetail(id);
  };

  detailEls.downBtn.hidden = downCount === 0;
  detailEls.downBtn.textContent = `下流を展開 (+${downCount})`;
  detailEls.downBtn.onclick = () => {
    expand(id, 'down');
    showDetail(id);
  };
}

// ============================================================
// 5b. 詳細パネルの開閉・リサイズ
// ============================================================
const detailPanel = document.getElementById('detail');
const divider = document.getElementById('divider');
const detailToggle = document.getElementById('detail-toggle');

function updateToggleUi() {
  const open = !detailPanel.hidden;
  detailToggle.textContent = open ? '▶' : '◀';
  detailToggle.setAttribute('aria-expanded', String(open));
  detailToggle.setAttribute('aria-label', open ? '詳細パネルを閉じる' : '詳細パネルを開く');
  // 閉状態ではリサイズ不能なので col-resize カーソルを出さない(CSS 側で打ち消す)
  divider.classList.toggle('panel-closed', !open);
}

function setPanelOpen(open) {
  detailPanel.hidden = !open;
  updateToggleUi();
  // コンテナサイズが変わるため、cytoscape 側のキャンバス寸法とヒットテストを追従させる
  if (cy) cy.resize();
}

detailToggle.addEventListener('click', () => setPanelOpen(detailPanel.hidden));

const PANEL_MIN_WIDTH = 240;
const GRAPH_MIN_WIDTH = 320; // グラフ側に最低限残す幅

function clampPanelWidth(w) {
  const max = Math.max(PANEL_MIN_WIDTH, window.innerWidth - GRAPH_MIN_WIDTH);
  return Math.min(Math.max(w, PANEL_MIN_WIDTH), max);
}

// トグルボタン上の pointerdown はドラッグ開始にしない(クリックとの競合防止)
detailToggle.addEventListener('pointerdown', (evt) => evt.stopPropagation());

let resizePointerId = null; // ドラッグ中のポインタ id(マルチタッチでのリスナー二重登録防止)

divider.addEventListener('pointerdown', (evt) => {
  if (detailPanel.hidden) return; // 閉じているときはリサイズしない
  if (resizePointerId !== null) return; // 既に別のポインタでドラッグ中なら無視する
  resizePointerId = evt.pointerId;
  evt.preventDefault();
  divider.setPointerCapture(evt.pointerId);
  document.body.classList.add('resizing');
  // 掴んだ位置とパネル左端のずれを補正する(未補正だとディバイダ幅ぶん最大 8px 程度
  // パネル幅がジャンプする)
  const grabOffset = evt.clientX - detailPanel.getBoundingClientRect().left;
  const onMove = (moveEvt) => {
    if (moveEvt.pointerId !== resizePointerId) return;
    detailPanel.style.flexBasis = `${clampPanelWidth(window.innerWidth - (moveEvt.clientX - grabOffset))}px`;
  };
  const finish = (endEvt) => {
    if (endEvt.pointerId !== resizePointerId) return;
    resizePointerId = null;
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', finish);
    divider.removeEventListener('pointercancel', finish);
    document.body.classList.remove('resizing');
    if (cy) cy.resize();
  };
  divider.addEventListener('pointermove', onMove);
  divider.addEventListener('pointerup', finish);
  divider.addEventListener('pointercancel', finish);
});

updateToggleUi();

// ============================================================
// 6. cytoscape イベント
// ============================================================
// (initCy() 内で tap / dbltap を登録済み)

// ============================================================
// 7. 検索
// ============================================================
function clearSearchHits() {
  if (cy) cy.nodes('.search-hit').removeClass('search-hit');
}

function doSearch(query) {
  clearSearchHits();
  const q = query.trim().toLowerCase();
  if (!q) return;

  const matches = graph.nodes.filter(
    (n) => n.name.toLowerCase().includes(q) || (n.file && n.file.toLowerCase().includes(q)),
  );
  if (matches.length === 0) return;

  // 検索とパスハイライトは別モードとして扱う。検索実行時に経路ハイライトの選択状態が
  // 残っていると「select は選択中なのに経路は消えている」という不整合が起きるため揃える。
  clearOnPath();
  if (entrySelect) entrySelect.value = '';
  dimFocus = null;

  const first = matches[0];
  if (!visible.has(first.id)) {
    visible.add(first.id);
    for (const e of outEdges.get(first.id) ?? []) visible.add(e.to);
    for (const e of inEdges.get(first.id) ?? []) visible.add(e.from);
    render();
  }
  applyDim();

  const eles = cy.collection();
  for (const n of matches) {
    if (!visible.has(n.id)) continue;
    const el = cy.getElementById(n.id);
    if (el && el.length > 0) {
      el.addClass('search-hit');
      eles.merge(el);
    }
  }

  if (eles.length > 0) {
    cy.animate({ center: { eles }, zoom: 1.2 }, { duration: 300 });
  }
}

// ============================================================
// 8. パスハイライト
// ============================================================
/** entryId -> targetId への単純パスを短い順に最大 limit 本まで列挙する(BFS、循環回避)。 */
function findPaths(entryId, targetId, limit = 20) {
  const results = [];
  const queue = [{ node: entryId, edges: [], visited: new Set([entryId]) }];
  let guard = 0;
  const GUARD_MAX = 20000; // 循環グラフでの探索爆発を防ぐ安全弁
  while (queue.length > 0 && results.length < limit && guard < GUARD_MAX) {
    guard += 1;
    const cur = queue.shift();
    if (cur.node === targetId) {
      if (cur.edges.length > 0) results.push(cur.edges);
      continue;
    }
    for (const e of outEdges.get(cur.node) ?? []) {
      if (cur.visited.has(e.to)) continue; // 単純パスのみ(循環回避)
      const nextVisited = new Set(cur.visited);
      nextVisited.add(e.to);
      queue.push({ node: e.to, edges: [...cur.edges, e], visited: nextVisited });
    }
  }
  return results;
}

function clearOnPath() {
  if (cy) cy.edges('.on-path').removeClass('on-path');
}

function observedUpstreamEntries() {
  return graph.nodes.filter(
    (n) => n.internal && n.id !== graph.target && (inEdges.get(n.id) ?? []).length === 0,
  );
}

function populateEntrySelect(select) {
  const note = '観測できた範囲の上流端であり、真のエントリポイントとは限りません';
  select.title = note;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- 経路ハイライトなし --';
  select.appendChild(placeholder);

  const candidates = observedUpstreamEntries();
  for (const n of candidates) {
    const paths = findPaths(n.id, graph.target, 20);
    const hasCallback = paths.some((path) => path.some((e) => e.kind === 'callback-passed'));
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = hasCallback ? `${n.name} ⚠` : n.name; // ⚠
    select.appendChild(opt);
  }
  select.disabled = candidates.length === 0;
  return note;
}

function onEntrySelectChange(entrySelect) {
  clearOnPath();
  dimFocus = null;
  // val が空(プレースホルダ)の場合はこの後 render() を呼ばずに早期 return するため、
  // ここで明示的に適用しておかないと dimFocus=null が .dimmed の除去に反映されない。
  // render() 内でも呼ばれるが、applyDim() は dimFocus===null なら何もしない設計なので
  // 二重に呼んでも副作用はない。
  applyDim();
  const val = entrySelect.value;
  if (!val) return;

  // 上流側を全展開してから経路を計算・着色する。
  for (const n of graph.nodes) {
    if (n.upstreamDistance != null) visible.add(n.id);
  }
  render();

  const paths = findPaths(val, graph.target, 20);
  for (const path of paths) {
    for (const e of path) {
      const el = cy.getElementById(e._id);
      if (el && el.length > 0) el.addClass('on-path');
    }
  }
}

// ============================================================
// 9. バナー
// ============================================================
function limitationText(key) {
  switch (key) {
    case 'dynamic-calls':
      return '静的解析では検出できない呼び出し(イベント・DI 等)があり得ます';
    case 'project-references':
      return 'project references 越しの参照は境界ノードになります';
    default:
      return key;
  }
}

function buildBanner() {
  const banner = document.getElementById('banner');
  banner.textContent = '';

  const metaLine = document.createElement('div');
  metaLine.className = 'meta-line';
  const meta = graph.meta ?? {};
  metaLine.textContent = `TS ${meta.tsVersion ?? '?'} (${meta.tsSource ?? ''}) / ${meta.tsconfig ?? '既定設定'}`;
  banner.appendChild(metaLine);

  if (meta.mode === 'reference') {
    const modeLine = document.createElement('div');
    modeLine.className = 'mode-line';
    modeLine.textContent = '参照グラフモード: 変数起点・上流のみ(この変数を読む関数とその呼び出し元)';
    banner.appendChild(modeLine);
  }

  if (meta.limitations && meta.limitations.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'limitations';
    for (const key of meta.limitations) {
      const li = document.createElement('li');
      li.textContent = limitationText(key);
      ul.appendChild(li);
    }
    banner.appendChild(ul);
  }

  if (graph.truncation) {
    const t = graph.truncation;
    const warn = document.createElement('div');
    warn.className = 'truncation-warning';
    const frontierPreview = (t.frontier ?? []).slice(0, 5).join(', ');
    warn.textContent =
      `⚠ ノード上限により打ち切り(収集済み: 上流 ${t.upstreamCount ?? 0} / 下流 ${t.downstreamCount ?? 0}` +
      `、未探索: ${frontierPreview || '(なし)'})`;
    banner.appendChild(warn);
  }

  const controls = document.createElement('div');
  controls.className = 'controls';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'search';
  searchInput.placeholder = '検索(名前 / ファイル)';
  controls.appendChild(searchInput);

  const expandAllBtn = document.createElement('button');
  expandAllBtn.type = 'button';
  expandAllBtn.id = 'expand-all';
  expandAllBtn.textContent = '全展開';
  controls.appendChild(expandAllBtn);

  const entryWrap = document.createElement('label');
  entryWrap.className = 'entry-select-wrap';
  const entryText = document.createElement('span');
  entryText.textContent = '経路ハイライト:';
  entryWrap.appendChild(entryText);
  const entrySelect = document.createElement('select');
  entrySelect.id = 'entry-select';
  entryWrap.appendChild(entrySelect);
  controls.appendChild(entryWrap);

  banner.appendChild(controls);

  const entryNote = document.createElement('div');
  entryNote.className = 'entry-note';
  banner.appendChild(entryNote);

  return { searchInput, expandAllBtn, entrySelect, entryNote };
}

// ============================================================
// 10. 全展開ボタン
// ============================================================
function expandAll() {
  clearOnPath();
  if (entrySelect) entrySelect.value = '';
  for (const n of graph.nodes) visible.add(n.id);
  render();
}

// ============================================================
// 初期化
// ============================================================
detailEls = buildDetailSkeleton();
const { searchInput, expandAllBtn, entrySelect, entryNote } = buildBanner();
entryNote.textContent = populateEntrySelect(entrySelect);

initCy();
render();
showDetail(graph.target); // 初期表示から詳細パネルを埋めておく(空状態を作らない)

searchInput.addEventListener('input', (evt) => doSearch(evt.target.value));
expandAllBtn.addEventListener('click', expandAll);
entrySelect.addEventListener('change', () => onEntrySelectChange(entrySelect));

// ============================================================
// テストフック(Playwright スモークテスト用)
// ============================================================
window.__cy = cy;
window.__showDetail = showDetail;
window.__graphTargetId = graph.target;
