# func-understand: 下流方向コールバック名前渡し検出 設計スペック

- 日付: 2026-07-30
- 対象: `plugins/cc-func-understand`(v0.5.1 フォローアップ、v0.6.0 予定)
- 起点: issue #9 — `items.map(helper)` のようにリポ内定義関数を名前渡しした場合、`helper` が下流ノードとしてグラフに全く現れない(v0.1.0 からの既存欠陥)。

## 問題

TypeScript の Call Hierarchy API(outgoing calls)は「呼び出し」だけを辿り、引数として渡された関数参照を辿らない。既存のコールバック検出(`lib/callback-edges.mjs`)は「グラフに既にあるノード」起点の `findReferences` による上流方向の仕組みで、対象関数の中で名前渡しされている未知の関数の**発見**には使えない。

## 実測プローブの結果(2026-07-30、設計の前提)

probe fixture(`target` が `items.map(helper)` / `items.map((x) => inner(x))` / `items.map(utils.fmt)` / `register('t', helper)` を含む)での実測:

1. **outgoing calls は `inner`(インラインアロー内の直接呼び出し)と `fmt`(PropertyAccess の名前渡し)を既に検出する**。欠落するのは**裸の Identifier 渡し(`helper`)のみ**。
2. `getDefinitionAtPosition` は import エイリアスを透過して解決し、返る `fileName` + `textSpan.start` が `collectDeclarations` のキー(`file#selectionStart`)と完全一致する(function / method とも確認済み)。
3. パラメータ等の非関数を引数に渡した場合(`arr.map(x)`)、解決先が `collectDeclarations` に無いため突き合わせで自然に落ちる。

## 決定事項

### 1. アーキテクチャ: 発見専用の後段パス(3案から選定)

CLI(`analyze-callgraph.mjs`)のパイプラインを次の3段にする:

```
buildGraph → addDownstreamCallbacks(新設 lib/downstream-callbacks.mjs) → addCallbackEdges
```

- 検討した代替案: (B) `addCallbackEdges` への統合 — 上流パスで新発見されるノードは下流スキャン不要(上流ノードの下流は元々辿らない設計)なので統合の実利がなく、複雑化のみ。(C) `stepDirection`(コア BFS)への組み込み — 予算公平性は最良だが「Call Hierarchy のみ」のコア層に AST スキャンが混入しリスク最大。→ v0.1.0 の上流コールバックと同じ「後段パス」パターンの (A) を採用(ユーザー選択)。
- トレードオフ: maxNodes 予算は buildGraph 消費後の残りになるが、既存の上流コールバックパスと同じ扱いで一貫する。

### 2. 新パス `addDownstreamCallbacks` の責務と手順

「下流側ノードの本体から、引数位置に名前渡しされたリポ内定義関数を発見してノード化する」ことのみを担う。

1. `downstreamDistance != null` の内部関数様ノード(target 含む。kind: function / method / arrow)をワークリストに積む
2. 各ノードの本体 AST を走査し、`CallExpression` / `NewExpression` の**引数位置にある Identifier / PropertyAccessExpression** を収集(検出範囲はユーザー決定: 引数位置のみ。オブジェクト/配列リテラル内・代入・return は対象外)
   - プローブの結果、実質的に効くのは Identifier のみだが、PropertyAccess も安全網として対象に含め重複排除で吸収する
3. 参照を `getDefinitionAtPosition` で解決(PropertyAccess は `.name` 側の位置で引く)し、`collectDeclarations` のキー(`file#selectionStart`)に一致した場合のみ採用
   - 非関数・外部・stdlib はこの突き合わせで自然に落ちる(`collectDeclarations` はプロジェクト内部ファイルのみ)
   - テスト関連ファイル内の宣言は `ctx.isFileExcluded` で除外
4. 採用したら `ctx.prepare` + `ctx.itemToNode` でノード追加、`callback-passed` エッジ(**包含ノード → 渡された関数**、参照行付き)を `ctx.upsertEdge` で追加、`downstreamDistance = 包含ノードの downstreamDistance + 1`
5. 新ノードは (a) `continueDownstream`(`continueUpstream` の鏡像として `graph-builder.mjs` に追加。`stepDirection('down')` と `visitedDown` を再利用)で direct-call の下流を継続探索し、(b) ワークリストに戻して自身の本体もスキャンする(fixpoint)
6. 後段の既存 `addCallbackEdges` は全ノードを enqueue するため、新ノードに対する上流方向のコールバックエッジ(他の関数が同じ helper を渡している箇所)も従来機構で自動的に張られる

### 3. 距離・予算・重複排除の規則

- **深さ制限**: 包含ノードの `downstreamDistance >= downstreamDepth` なら新規発見しない(direct-call の下流打ち切りと同じ規則)
- **maxNodes 予算**: 既存パターンを踏襲 — 上限到達時はノード化せず `truncation.reason = 'max-nodes'` とし `truncation.frontier` に関数名を積む
- **direct-call との二重計上防止**: 解決先ノードへの「同じ包含ノードからの direct-call エッジ」が同一行を記録している場合はスキップ(`utils.fmt` のような outgoing calls 検出済みケース)。両端点が判明しているため、既存 upstream パスのファイル+行マーカーより精密な from→to+行 の判定にする
- **callee 位置の除外**: 引数位置のみ走査するため `map(helper())` のような直接呼び出しは構造的に混入しない(明示的な callee 判定は不要)
- **エッジの重複**: 後段 `addCallbackEdges` が同じ参照を再発見しても `upsertEdge` のキー(`from->to#kind`)で行マージされ二重化しない(既存機構、変更不要)
- **kind の付与**: 新ノードは既存の `itemToNode` を通すため従来どおり(function / method / arrow)

### 4. スコープ外(YAGNI)

- オブジェクト/配列リテラル内の関数参照(`{ onClick: helper }` / `[helper]`)— ユーザー決定で対象外
- 代入(`const h = helper`)・return 位置の参照
- `register(helper)` の「register が helper を呼ぶ」という間接呼び出しのモデル化(フラットな `包含関数 → helper` エッジで表現し、`map(helper)` と扱いを統一)
- ビューア(`templates/`)の変更は無し(`callback-passed` は既に破線 + `callback` ラベル表示に対応済み)

## テスト

- **新 fixture** `test/fixtures/downstream-callback/` + 単体テスト(`node --test`):
  - issue #9 の実測ケース: `items.map(helper)` の `helper` が下流ノード + `callback-passed` エッジになる(downstreamDistance = 包含 + 1)
  - 自作関数経由: `register('t', helper)` も同じくフラットな `callback-passed` エッジになる
  - import 越しの helper(別ファイル定義)が解決される
  - `items.map(utils.fmt)`: direct-call(既存検出)と二重計上されない
  - `arr.map(x)`(パラメータ渡し)が誤検出されない
  - 新ノードからの下流継続: helper 自身が呼ぶ関数が direct-call で現れる
  - 新ノードへの上流コールバック: 別関数が同じ helper を渡している場合、後段パスでその関数もノード化される
  - `--downstream-depth` による打ち切り、`--max-nodes` 到達時の `truncation.frontier` 計上
  - テスト関連ファイル内の宣言に解決される参照が除外される
- 既存 unit + Playwright smoke がすべて green のまま

## ドキュメント

- README「既知の制約」の該当項目(名前渡しが検出されない旨)を更新・削除
- SKILL.md の説明に下流コールバック検出を反映
- plugin.json を v0.6.0 に更新

## 経緯メモ

- 検出範囲「呼び出しの引数位置のみ」/ アプローチ「案A: 発見専用の後段パス」はユーザー選択(2026-07-30)
- 設計レビューは Claude 自身の再考 + 実測プローブで実施(Codex 委譲はしない方針)
- プローブで「PropertyAccess・インラインアローは既存検出済み、欠落は裸 Identifier のみ」と判明し、当初想定よりスコープが狭いことを確認
