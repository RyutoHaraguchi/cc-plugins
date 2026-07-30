# func-understand: 参照グラフモード(変数起点の影響範囲グラフ)設計スペック

- 日付: 2026-07-30
- 対象: `plugins/cc-func-understand`(issue #21 / #22 項目7、issue #8 の (b) 案)
- 起点: `/func-understand API_CONFIG` のように**モジュールレベルの変数**を指定すると、現状は `not-a-function`(exit 2)で終了するのみ。「その変数をどの関数が読んでいるか」= 影響範囲を上流方向にグラフ化するモードを追加する。

## 決定事項(ブレスト確認済み、2026-07-30)

| 論点 | 決定 |
|---|---|
| ユースケース | 影響範囲調査(直接読む関数だけでなく、その上流の呼び出し元まで辿る) |
| 起動方法 | 自動フォールバック(変数名指定でそのまま参照グラフを生成、exit 0) |
| 起点にできる宣言 | モジュールレベルの値宣言(変数・enum)のみ |
| catch/for-of ノイズ | 関数内ローカル変数を not-a-function 検出から除外して同時解消 |
| 実装アプローチ | A案: 専用モジュール新設+既存上流機構(`continueUpstream` / `addCallbackEdges`)の再利用 |
| reads/writes の区別 | 区別しない(すべての参照を `reads` エッジとして扱う。YAGNI) |

## 1. 起動フロー(CLI / target-resolver)

### resolveTarget の拡張(`lib/target-resolver.mjs`)

- 関数として見つからない場合(`matched.length === 0`)、**モジュールスコープの値宣言**(VariableStatement 直下の VariableDeclaration・EnumDeclaration)への名前一致を先に確認する:
  - 一致 1 件 → 新ステータス **`resolved-variable`** と宣言情報(`declaration`: file / relFile / kind(`variable` | `enum`)/ selectionStart / startLine / endLine)を返す
  - 一致複数 → 既存と同じ **`ambiguous`**(candidates に kind 付きで返す)
  - `--file` / `--line` の絞り込みフィルタは関数と同じものを適用する
- `collectNonFunctionDeclarations` の整理:
  - **変数は「モジュールスコープの VariableStatement」のみ**を対象にする(関数内ローカル・catch 節・for-of/for-in のループ変数は検出しない → 指定時は従来どおり `not-found`)
  - class / interface / type は従来どおり検出し `not-a-function` を返す(参照グラフの起点にはしない)
  - enum・モジュールスコープ変数は `resolved-variable` 側で処理されるため、not-a-function の matches には現れなくなる

### CLI(`analyze-callgraph.mjs`)

- `resolved-variable` のとき `buildReferenceGraph`(新設)で解析し、graph.json を出力して **exit 0**
- stdout JSON と `graph.meta` に **`mode: "reference"`** を含める(関数グラフは従来どおり `mode` なし、または `"call"` は付けない — 既存出力を変えない)
- `--downstream-depth` は参照グラフでは無意味なので無視する(エラーにはしない)
- テスト除外(`.func-understand.json` / `--include-tests` / 起点がテストファイル内なら無効化)は既存の仕組みをそのまま通す

## 2. グラフ構造(`lib/reference-graph.mjs` 新設)

### 起点ノード

- kind: `variable`(enum は `enum`)、`internal: true`、`upstreamDistance: 0`、`downstreamDistance: null`
- `code` は宣言文全体(VariableStatement / EnumDeclaration の範囲、既存 truncateCode を適用)
- id は既存規約どおり `${relFile}#${selectionStart}`

### reads エッジ(新 kind)

- `from`: 参照を包含する最内の関数様宣言ノード / `to`: 変数ノード / `kind: "reads"` / `callLines`: 参照行(同一 from→to は行マージ)
- 参照の収集は `findReferences` 起点。以下は既存 callback-edges のヘルパーを流用する:
  - 包含関数の逆引き(collectDeclarations の行範囲逆引き)
  - 包含関数がない参照(モジュールトップレベル)→ module ノード化
  - import / export 文中の参照は除外(`isInImportOrExport`)
  - 宣言自身(`isDefinition`)は除外
  - テスト関連ファイル内の参照はノード化しない(`ctx.isFileExcluded`)

### 上流 BFS の継続

- reads エッジで発見された関数ノードは `upstreamDistance: 1` から始め、`continueUpstream` で direct-call の上流を既存どおり辿る
- 仕上げに `addCallbackEdges` を適用し、名前渡し経由の上流も検出する(既存 CLI パイプラインと同じ構成)
- 下流方向の探索はしない(変数は呼び出さないため片方向グラフ)
- `maxNodes` / `--upstream-depth` / truncation(frontier)は既存の仕組みがそのまま効く

## 3. ビューア(`templates/`)

- `variable` / `enum` ノードのスタイルを追加(枠色で関数ノードと区別。起点は既存 `is-target` スタイルを併用)
- `reads` エッジのスタイル(色分け+`reads` ラベル)を追加。既存 `callback` エッジのラベル方式と同様
- バナーに `meta.mode === "reference"` のとき「参照グラフモード(変数起点・上流のみ)」を表示する
- 検索・展開・経路ハイライト・詳細パネルは既存実装のまま動くこと(構造が同じノード/エッジ形式のため変更不要の想定。動かない箇所が見つかったら最小修正)

## 4. SKILL.md / ドキュメント

- SKILL.md: 変数名を指定した場合の挙動を「参照グラフモード」として説明(exit 0 / `mode: "reference"` の解釈、上流のみである旨、グラフの読み方)。not-a-function のハンドリング記述から変数・enum を外し、class / interface / type 用に更新
- README: モード説明・既知の制約(関数内ローカル変数は起点にできない等)を追記
- CHANGELOG: v0.7.0 として記録(機能追加)
- plugin.json / README のバージョンを **v0.7.0** に上げる

## 5. テスト

- fixture `test/fixtures/reference-graph/` 新設:
  - モジュール変数(オブジェクト定数)+それを読む関数複数(別ファイル含む)
  - 読む関数の上流呼び出し元(direct-call)と名前渡し上流(callback-passed)
  - 同名の関数内ローカル変数(誤って起点・参照扱いされないこと)
  - enum とそれを読む関数
  - テスト除外対象ファイルからの参照
  - モジュールトップレベルからの参照(module ノード化)
- unit:
  - `test/reference-graph.test.mjs` 新設(上記 fixture の構造検証、reads エッジ・上流継続・除外)
  - `test/target-resolver.test.mjs`: `resolved-variable` / ambiguous / `--file`・`--line` 絞り込み / 関数内ローカルの not-found 化(catch・for-of 含む)
  - `test/cli.test.mjs`: E2E 1件(変数指定 → exit 0、`mode: "reference"`、graph.json 生成)。既存 not-a-function E2E は class 指定などに更新
- smoke: `variable` ノードと `reads` エッジが描画され、バナーにモード表示が出る1件を追加
- 既存 unit + smoke がすべて green のまま(関数グラフの出力は完全不変)

## スコープ外(変えないこと)

- 関数グラフ(既存パイプライン)の出力・挙動
- reads / writes の区別(必要になったら別途)
- 関数内ローカル変数・class・interface・type の参照グラフ化
- not-a-function レスポンス自体の廃止(class / interface / type では引き続き返る)

## 経緯メモ

- ユースケース(影響範囲調査)、起動方法(自動フォールバック)、対象宣言(モジュールレベル値宣言)、アプローチ(A案)、reads/writes(区別しない)はいずれも AskUserQuestion で確認済み(2026-07-30)。
- issue #21 の「catch/for-of ノイズ整理」は本設計の「対象宣言の範囲」決定に統合(モジュールスコープ限定により解消)。
