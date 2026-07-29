# func-understand: not-a-function ステータス追加 設計スペック

- 日付: 2026-07-29
- 対象: `plugins/cc-func-understand`(v0.5.0 フォローアップ、issue #8)
- 起点: `/func-understand API_CONFIG` のように**関数ではない変数**(オブジェクト定数・プリミティブ定数など)を指定すると、単なる `not-found`(exit 2、`suggestions` も空)が返り、「その名前は存在するが関数ではない」ことが伝わらず typo と誤解させる(2026-07-29 実測確認済み)。

## 問題

`lib/target-resolver.mjs` の `collectDeclarations` は Call Hierarchy 解析の起点となる**関数系宣言のみ**(function 宣言 / クラスメソッド / アロー関数・関数式の変数宣言 / 関数初期化子のプロパティ代入)を収集する。これは意図した設計だが、関数以外の名前付き宣言(変数・クラス・enum・interface・type エイリアス)を指定した場合もすべて `not-found` に落ち、エラーメッセージが不親切。

## 決定事項

### 1. 対応方針: issue の (a) 最小対応

`status: "not-a-function"` を追加してメッセージを区別する。(b) の参照グラフモード(findReferences ベースの別モード)はスコープ外(採用する場合は別 issue でブレストからやり直す)。

### 2. 検出範囲: 名前付き宣言全般

変数(オブジェクト/プリミティブ定数)に加え、名前で引ける宣言を幅広く検出し、種別(kind)付きで伝える:

| 宣言 | kind |
|---|---|
| VariableDeclaration(初期化子が関数でない、または初期化子なし) | `variable` |
| ClassDeclaration(名前あり) | `class` |
| EnumDeclaration | `enum` |
| InterfaceDeclaration | `interface` |
| TypeAliasDeclaration | `type` |

PropertyAssignment(非関数)・getter/setter は対象外(YAGNI。実測ケースは変数のみで、必要になったら追加する)。

### 3. 実装: not-found 経路でのフォールバック走査(A案)

- **`lib/target-resolver.mjs`**:
  - 新関数 `collectNonFunctionDeclarations(ts, proj, name)` を追加。上表の宣言のうち**指定名に一致するもののみ**収集する(全宣言の収集はしない)。
  - `resolveTarget` の not-found 経路(`matched.length === 0`)でのみ呼び出す。一致があれば `{ status: 'not-a-function', matches, suggestions }` を返す。一致がなければ従来どおり `{ status: 'not-found', suggestions }`。
  - `matches` の各要素: `{ kind, relFile, startLine, signature }`(signature は既存 decl と同じく宣言行の先頭 120 文字)。同名宣言が複数あればすべて含む。
  - `suggestions` は既存 not-found と同じ部分一致の関数候補(再入力の助けになるため残す)。
  - **既存の `collectDeclarations` は無変更**(graph-builder / callback-edges が「関数系宣言のみ」の前提で共用しているため)。正常系のコストもゼロ。
- **`scripts/analyze-callgraph.mjs`**: `not-a-function` の出力分岐を追加。exit code は他の解決失敗と同じ **2**:

```json
{ "status": "not-a-function",
  "matches": [{ "kind": "variable", "relFile": "src/config.ts", "startLine": 3, "signature": "const API_CONFIG = {" }],
  "suggestions": [] }
```

### 4. SKILL.md のハンドリング: 説明+再入力促し

exit 2 のハンドリング一覧に追記する:

- **exit 2, `status: "not-a-function"`**: `matches` を使い「`NAME` は kind として `relFile:startLine` に実在しますが、関数ではないため呼び出しグラフの起点にできません」とユーザーに説明する。`suggestions` が空でなければ候補として提示し、関数名の再入力を促す(AskUserQuestion または自由入力での確認)。

Claude が変数の参照元関数を探して提案する手順は入れない(最小対応。必要なら (b) 側で検討)。

### 5. スコープ外(変えないこと)

- (b) 参照グラフモード(別 issue でブレストから)
- `collectDeclarations` のシグネチャ・収集対象
- ambiguous / not-found / ok の既存挙動(完全な typo は従来どおり `not-found`)

## テスト

- **`test/target-resolver.test.mjs`** に追加:
  - オブジェクト定数(`const API_CONFIG = {...}`)→ `not-a-function`、kind `variable`
  - プリミティブ定数(`const MAX_RETRIES = 3`)→ `not-a-function`、kind `variable`
  - クラス名 → `not-a-function`、kind `class`
  - 完全な typo → 従来どおり `not-found`
  - アロー関数の const → 従来どおり `resolved`(リグレッション確認)
- **`test/cli.test.mjs`** に E2E を1件追加: 非関数変数を指定 → exit 2、stdout JSON の `status` が `not-a-function` で `matches` を含む。
- 既存 unit + Playwright smoke がすべて green のまま。

## ドキュメント・バージョン

- SKILL.md: 上記ハンドリング追記。
- README: エラーハンドリングに関する記述があれば追随。
- plugin.json / README のバージョンを v0.5.1 に上げる(挙動追加のみの後方互換な修正)。

## 経緯メモ

- 対応方針 (a)/(b)、検出範囲(名前付き宣言全般)、SKILL.md ハンドリング(説明+再入力促し)、実装アプローチ(フォールバック走査)はいずれも AskUserQuestion で確認済み(2026-07-29)。
