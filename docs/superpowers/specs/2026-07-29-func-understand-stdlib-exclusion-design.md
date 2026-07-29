# func-understand: 標準ライブラリ除外 設計スペック

- 日付: 2026-07-29
- 対象: `plugins/cc-func-understand`(v0.1.x フォローアップ)
- 起点: 実利用でのフィードバック — `buildAmbiguousMessage` のグラフに `get` / `push` / `join` / `map` / `flatMap` など組み込みメソッドが下流ノードとして大量に出て、「リポ内で独自定義した関数」を見たいという本来の目的のノイズになる。

## 問題

現状の internal/external 判定は「tsconfig の対象ファイル集合に含まれるか」(`project-loader.mjs` の `isInternal`)のみ。外部はすべて一律に `external-boundary` ノードになるため、次の 3 種が区別されずグラフに載る:

| 種別 | 解決先(実測) | 現状 | あるべき姿 |
|---|---|---|---|
| TS 標準ライブラリ(`Array.prototype.push` 等) | `<typescript>/lib/lib.*.d.ts` | 境界ノード | **ノード化しない** |
| Node 組み込み(`fs.readFileSync` 等) | `<project>/node_modules/@types/node/*.d.ts` | 境界ノード | **ノード化しない** |
| npm パッケージ(`express` 等) | `<project>/node_modules/<pkg>/…` | 境界ノード | 境界ノードのまま(依存情報として価値がある) |

## 決定事項

### 1. 分類器 `lib/symbol-classifier.mjs` を新設

CallHierarchyItem の解決先から `'stdlib' | 'other'` を返す純関数を置く(internal 判定は従来どおり `proj.isInternal` の責務のまま変えない)。

- **TS 標準ライブラリ**: `program.getSourceFile(file)` が得られ、かつ `program.isSourceFileDefaultLibrary(sourceFile)` が true。
  - パスのパターンマッチ(`lib.*.d.ts` 等)は使わない。公式 API はプロジェクト版 TS / 同梱版 TS、`lib` 置換パッケージ(`@typescript/lib-dom` 等)のいずれでも TS 自身の認識と一致する(実測確認済み: lib.es5.d.ts / lib.es2015.collection.d.ts → true、`@types/node` → false、プロジェクト内ファイル → false)。
- **Node 組み込み**: パスが `node_modules/@types/node/` セグメントを(パス区切り込みで)含む。`@types/node-fetch` などの別パッケージを誤爆しない判定にする。プラットフォーム標準として stdlib 側に含める。
- 上記いずれでもなければ `'other'`(→ 従来どおり境界ノード or 内部ノード)。
- 解決先が program に無い場合はフォールバックせず `'other'`(劣化は「境界ノードが 1 個余計に出る」だけの表示上の問題。YAGNI)。

### 2. 適用箇所は `stepDirection` のループ先頭、maxNodes チェックより前

`graph-builder.mjs` の `stepDirection` で、`peerItem` が stdlib なら **ノードもエッジも作らず continue** する。

- **maxNodes チェックより前に置く理由**: 後ろに置くと stdlib シンボルが `truncation.frontier` に積まれ、「グラフが上限で打ち切られたので `--upstream-depth` 等で再実行を」という誤った案内が出る。
- **`itemToNode` に入れない理由**: `callback-edges.mjs` からも呼ばれており null 返しで壊れる。なお callback-edges 側が扱うのは内部宣言(`collectDeclarations` はプロジェクトファイルのみ)と内部ファイルの moduleItem だけなので、stdlib が混入する経路は無い(確認済み)。
- 上下流どちらの方向にも適用する(上流に d.ts からの呼び出し元が現れることは実質無いが、分岐を分ける理由も無い)。

### 3. スコープ外(変えないこと)

- npm パッケージの境界ノード表示は従来どおり(パッケージ名表示などの見せ方改善は別件)。
- `--include-stdlib` のような復元フラグは作らない(YAGNI。必要になったら追加できる)。
- 下流方向のコールバック名前渡し(`items.map(helper)` の `helper` が outgoing calls に現れず、現状グラフから完全に欠落する件)は**既存の欠陥だが本件のスコープ外**。別イテレーションでブレストからやり直す。今回の変更で悪化はしない(元々見えていない)。
- ビューア(`templates/`)の変更は無し。stdlib ノードは JSON に入らなくなるので UI 側の対応は不要。

## テスト

- **分類器の単体テスト**(`node --test`):
  - 実 fixture の program で `lib.*.d.ts` 解決シンボルが stdlib 判定になる。
  - `node_modules/@types/node/fs.d.ts` パスが stdlib、`node_modules/@types/node-fetch/index.d.ts` パスが other(誤爆防止)。パス判定部は program 無しで検証できる形にする。
- **統合 fixture** `test/fixtures/stdlib/`:
  - `push` / `map` / `join` / `Map.get` を呼ぶ内部関数を用意し、解析結果に stdlib ノードが存在しないこと、内部ノード・内部エッジは従来どおり残ることを検証。
  - fixture 内に疑似 npm パッケージ(`node_modules/fake-pkg/` + 型)を置き、npm 由来の境界ノードは残ることを検証(scripts/.gitignore は `/node_modules/` 先頭スラッシュ付きのため fixture 配下は追跡される)。
  - `truncated` が発生しない(frontier に stdlib が積まれない)ことを確認。
- 既存 unit 39 件 + Playwright smoke 4 件がすべて green のまま。

## ドキュメント

- README「既知の制約」と SKILL.md「注意」に「TS 標準ライブラリ・Node 組み込みへの呼び出しはノード化されない(npm パッケージは境界ノードとして表示)」を追記。
- AI 要約手順は変更不要(external ノードは元々 `summary` を持たない)。

## 経緯メモ

- 方針決定: ユーザー選択「標準のみ除外、npm は残す」(2026-07-29)。
- Codex への設計レビュー委譲は 2 回試行(1 回目は serena MCP ツール失敗後にハング、2 回目はランタイム再起動を挟み遅延)し、ユーザー判断で打ち切り。本スペックは Claude の自己レビュー(公式 API への切替を含む)で確定。
