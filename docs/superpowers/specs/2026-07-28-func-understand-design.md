# cc-func-understand 設計ドキュメント

日付: 2026-07-28
ステータス: 承認済み(ブレスト完了 → サブエージェント + Codex による設計レビューを反映済み)

## 目的

AI 駆動開発では、個々の関数の呼び出し関係や処理内容を人間が把握するのに時間がかかる。オンボーディング時に「何をどこから読めばいいか」も分かりにくい。この課題に対し、**指定した関数を軸に、呼び出しチェーン(上流: ルーティング層まで / 下流: 依存の末端まで)を静的解析で正確に検出し、リッチなインタラクティブ HTML として可視化する** Claude Code スキルを作る。

利用イメージ:

```
/func-understand test()
```

→ `test` 関数を軸にした呼び出しグラフの HTML が生成され、ブラウザで確認できる。ユーザーは全体を視覚的に把握し、本当に必要な箇所だけコードを読む。

### 検出保証の範囲

- **直接呼び出し**(TypeScript が型情報で解決できる呼び出し式)は Call Hierarchy API で正確に検出する。
- **参照渡し**(`app.post("/x", handler)` や `items.map(fn)` のように関数を名前で登録・引き渡しするパターン)は Call Hierarchy では検出できないため、`findReferences` ベースの**参照エッジ後処理**で補完し、直接呼び出しと視覚的に区別して表示する(破線 + `callback-passed` ラベル)。
- それでも検出できない動的パターン(イベントエミッタ、DI コンテナ、computed dynamic import、Next.js の file-based route 等)は存在するため、HTML に「検出できない呼び出しがあり得る」注記を常設する。

## 決定事項サマリー

| 論点 | 決定 |
|---|---|
| 対象言語 | TS/JS に絞る(v1)。素の JS は `allowJs` で対応 |
| 解析方式 | TypeScript Compiler API の Call Hierarchy + findReferences 参照エッジ(同梱 Node スクリプト) |
| TypeScript 本体 | 検証済み TS 5系をスキル側に**バージョン固定で同梱**(初回 `npm install`)。プロジェクト版は `createLanguageService` の存在チェックを通過した場合のみ使用(TS 7 は Go ネイティブ版で LanguageService API が存在しないため不可) |
| 探索範囲 | 自プロジェクトコードは上流・下流とも全展開。外部は境界ノードとして名前のみ表示 |
| 参照エッジ | **v1 に含める**。名前渡し・コールバック登録を `callback-passed` エッジとして検出し、参照元からも上流探索を継続 |
| ノードの中身 | 生コード(シンタックスハイライト)+ AI 要約の両方 |
| AI 要約範囲 | **対象関数から距離2以内のみ**。それより外は `summary: null` のまま UI で「要約未生成」表示 |
| 成果物 | 単一 HTML ファイル。**ライブラリはインライン埋め込みで真に自己完結**(オフラインでも動作、ファイルサイズ +約1MB を許容) |
| UI 必須機能 | ノード段階的展開/折りたたみ、実行パスハイライト、関数名・ファイル名検索、ノードクリックで詳細パネル |
| UI テスト | Playwright による最小 smoke test(ロード・展開・検索・XSS fixture)を自動化 |
| UI 対象外(v1) | エディタで開くリンク(vscode:// 連携) |

## アーキテクチャ

### プラグイン構成

cc-html と同じパターンで、マーケットプレイスリポジトリに新プラグインとして追加する。

```
plugins/cc-func-understand/
├── .claude-plugin/plugin.json
├── commands/func-understand.md        # /func-understand コマンド定義
└── skills/func-understand/
    ├── SKILL.md                       # エージェント向け手順書
    ├── scripts/analyze-callgraph.mjs  # 解析スクリプト(決定的処理)
    ├── scripts/package.json           # 同梱 TypeScript 5系(バージョン固定)
    └── templates/viewer.html          # UI テンプレート(ライブラリインライン済み)
```

### データフロー(4段階パイプライン)

役割分担の原則: **正確性が必要な工程はプログラム、意味理解が必要な工程は LLM**。

1. **ターゲット解決** — エージェントが解析スクリプトに関数名を渡して実行。スクリプトは AST スキャンで宣言を列挙し、複数マッチ時は候補一覧(ファイル・行・シグネチャ・所属クラス)を JSON で返す。エージェントは AskUserQuestion でユーザーに選択させ、`--file` + `--line` 指定で再実行する。
2. **グラフ抽出(決定的)** — 同梱スクリプトが Call Hierarchy API で上流・下流を BFS 探索し、findReferences で参照エッジを補完し、生コード・位置情報込みのグラフ JSON を出力。LLM はこの工程に関与しない。
3. **AI 要約生成** — エージェントが JSON を読み、`min(upstreamDistance, downstreamDistance) <= 2` のノードに 1〜3 行の要約を付与。対象が 30 を超える場合はサブエージェントで分担し、距離が近い順に優先する。範囲外のノードは `summary: null` のまま。
4. **HTML 生成** — テンプレートにグラフ JSON + 要約を埋め込み、`<project-root>/docs/func-understand/YYYY-MM-DD-HHMM-<関数名>.html` に出力してブラウザで開く。

## 解析スクリプト仕様(analyze-callgraph.mjs)

### 実行インターフェース

```
node analyze-callgraph.mjs --project <対象ルート> --function <関数名> [--file <相対パス>] [--line <行>]
  [--tsconfig <パス>] [--upstream-depth <n>] [--downstream-depth <n>] [--max-nodes <n>] --out <出力JSON>
```

- `--function` のみ → AST スキャンで候補解決。一意なら解析続行、複数なら候補一覧 JSON を返して終了。
- `--file` + `--line` → 曖昧性解決後の再実行用。指定位置の宣言をターゲットにする。
- `--tsconfig` → tsconfig 自動検出のオーバーライド(モノレポで必須になるケースがある)。
- `--max-nodes` 既定 300。`--upstream-depth` / `--downstream-depth` は既定無制限(打ち切り時の再実行用)。

### TypeScript の解決

1. 対象プロジェクトの `node_modules/typescript` をロードし、`typeof ts.createLanguageService === 'function'` を確認。通過すれば使用(対応範囲: 4.x〜5.x)。
2. 不可(TS 7 系 = Go ネイティブ版は LanguageService API 自体が存在しない / TS 未インストール)なら、スキル同梱のバージョン固定 TS 5系を使用(`scripts/package.json` で管理、初回のみ `npm install`)。
3. 使用した TypeScript バージョンと tsconfig パスはグラフ JSON の `meta` に記録し、HTML にも表示する。

### tsconfig の解決

- `--tsconfig` 指定があればそれを使用。なければ対象ルートから最も近い `tsconfig.json` を自動検出。
- tsconfig が存在しない場合の既定 compilerOptions: `allowJs: true, checkJs: false, module: esnext, moduleResolution: bundler, jsx: preserve`。root files は対象ルート配下の `.ts/.tsx/.js/.jsx/.mjs/.cjs` を列挙(`node_modules`・`dist`・`build`・`.git` 等を除外)。
- **既知の制約(v1)**: project references / ビルド成果物(`.d.ts`)越しの参照は境界ノードになる(検証済み: composite パッケージ間の呼び出しは emit 済み `.d.ts` に解決される)。この制約はスペックと HTML 注記の両方に明記する。

### ターゲット位置解決(AST スキャン)

`prepareCallHierarchy` は**宣言名の位置(fileName + offset)を要求する**(検証済み: 関数 body 内の位置では `undefined`)ため、名前→宣言位置の解決工程を持つ。

- プロジェクトのソースファイルを AST 走査し、function 宣言・const arrow・class method・object method の宣言を列挙。
- `--function` の名前と一致する宣言が 1 件なら確定、複数なら候補一覧(ファイル・行・シグネチャ・containerName)を返す。0 件なら近似候補(部分一致・大文字小文字無視)を返す。
- **匿名関数(匿名 default export arrow 含む)は v1 のターゲット対象外**(検証済み: `prepareCallHierarchy` が `undefined` を返す)。
- re-export alias が指定された場合は definition 解決後の元宣言を候補として提示する(検証済み: 実呼び出しは元宣言に解決される)。

### 探索ロジック

- 確定した宣言位置で `prepareCallHierarchy` を実行(複数 item が返った場合は候補解決で確定した宣言位置に一致する 1 件を使用)。以降の BFS では各 item の `file + selectionSpan.start` を次の `provideCallHierarchyIncomingCalls` / `provideCallHierarchyOutgoingCalls` 呼び出しに引き回す。
- **上流・下流の queue を交互に消費**し、片方向の高 fan-out がもう片方の探索枠を食い潰さないようにする。
- visited 管理は**方向別**に持つ(同一ノードが上流・下流の両方から到達し得るため)。循環はエッジとして残し UI で表示する。
- **内外判定**: パス文字列(`node_modules` 含有)ではなく「選択した tsconfig の source file membership(program の fileNames に含まれるか)」で行う(pnpm symlink / workspace パッケージの誤分類を防ぐ)。外部・`.d.ts` のみのシンボルは境界ノードとして打ち切る。
- **参照エッジ後処理**: 探索済みの内部ノード各々について `findReferences` を実行し、direct-call エッジの callSites に含まれない参照のうち「呼び出し式でない識別子参照」(引数位置の名前渡し・プロパティ値・配列要素など)を `callback-passed` エッジとして追加する。参照元の包含関数をノード化し、**そこから上流 BFS を継続する**(これによりコールバック登録型ルーティングでもルーティング層まで到達できる)。
- **打ち切り**: 総ノード数が `--max-nodes` に達したら停止し、`truncation` に理由・方向別ノード数・未探索 frontier ノード一覧を記録する。

### グラフ JSON スキーマ

```jsonc
{
  "target": "src/services/user.ts#1234",   // ターゲットノードの id
  "meta": {
    "tsVersion": "5.9.3",
    "tsconfig": "tsconfig.json",           // null = 既定設定で解析
    "limitations": ["project-references", "dynamic-calls"]  // HTML 注記用
  },
  "truncation": null,                       // 打ち切り時: { reason, upstreamCount, downstreamCount, frontier: [nodeId] }
  "nodes": [{
    "id": "src/services/user.ts#1234",     // 相対パス + selectionSpan.start(同名シンボルでも衝突しない)
    "name": "test",
    "containerName": "UserService",         // 所属クラス等。表示用。null 可
    "kind": "function",                     // function | method | arrow | class | module | external-boundary
                                            // (arrow は API では function で返るため AST で独自判定)
    "internal": true,                       // false = 境界ノード。以下 file〜code は internal のみ必須
    "file": "src/services/user.ts",
    "startLine": 10, "endLine": 42,
    "code": "...",                          // 生コード。arrow は親 VariableDeclaration まで含める。
                                            // module ノードは呼び出し箇所 ±10 行の抜粋。
                                            // 1 ノード上限 16KB、超過分は切り詰めて codeTruncated: true
    "codeTruncated": false,
    "upstreamDistance": null,               // number | null(方向別。双方向到達・循環に対応)
    "downstreamDistance": 2,
    "summary": null                         // min(両距離) <= 2 のノードにエージェントが埋める
  }],
  "edges": [{
    "from": "...", "to": "...",
    "kind": "direct-call",                  // direct-call | callback-passed
    "callLines": [15, 28]                   // 同一ペアの複数回呼び出しに対応(検証済み: fromSpans は複数返る)
  }]
}
```

## HTML/UI 設計

技術スタック: Cytoscape.js + dagre + cytoscape-dagre(グラフ描画)、highlight.js core + TS/JS 言語パック(コードハイライト)。**すべてテンプレート HTML にインライン埋め込みし、ネットワーク接続なしで完全動作する**(ファイルサイズ +約1MB を許容)。データも埋め込み、真に自己完結とする。

### 埋め込みの安全性(XSS / script break-out 対策)

- グラフ JSON は `<script type="application/json">` に埋め込み、`<` `</script` U+2028 U+2029 をエスケープする(生コードには任意の文字列が含まれ得るため必須)。
- DOM への挿入は `textContent` を基本とし、`innerHTML` は highlight.js が生成した HTML に限定する。
- 悪意ある文字列(`</script>`、HTML 断片、イベントハンドラ属性)を含む fixture でテストする。

### レイアウトとインタラクション

- **左: グラフキャンバス** — 左→右のレイヤードレイアウト(上流 → 対象 → 下流)。対象関数は色とサイズで強調。境界ノードは点線、`callback-passed` エッジは破線 + ラベルで直接呼び出しと区別。レイアウトは**表示中ノードのみ**に適用する(300 ノード一括レイアウトを避ける)。
- **右: 詳細パネル** — ノードクリックで AI 要約(未生成なら「要約未生成」ラベル)+ シンタックスハイライト付き生コード + ファイルパス・行番号を表示。
- **段階的展開** — 初期表示は対象関数 ±1 ホップ。**詳細表示は通常クリック、展開は専用バッジ(chevron)に分離**し、上流・下流を個別に開閉できる。展開バッジには隠れている件数を表示。初期表示・展開時とも方向別の表示上限 20 件とし、超過分は「+N 件」ノードに集約する(高 fan-out 対策)。「全展開」ボタンも用意。
- **実行パスハイライト** — **観測上流端**(検出できた範囲で呼び出し元がないノード。真のエントリポイントとは限らない旨を UI に表記)の一覧から選択すると、そこから対象関数までの経路を着色。表示パス上限 20(短い順)、超過時はメッセージ表示。パスモード起動時は上流を自動展開する。`callback-passed` エッジを含む経路には警告アイコンを付す。
- **検索** — 関数名・ファイル名のインクリメンタル検索。ヒットしたノードへパン&フォーカス(未展開領域にあれば自動展開)。
- **常設情報** — 使用 TS バージョン・tsconfig・既知の制約(検出できない動的呼び出し、project references 境界)・打ち切り情報をヘッダ領域に表示。

## エラー処理

| 状況 | 挙動 |
|---|---|
| 関数が見つからない | スクリプトが近似名の候補(部分一致・大文字小文字無視)を JSON で返し、エージェントが提示して再入力を促す |
| 同名関数が複数 | 候補一覧(ファイル・行・シグネチャ・containerName)を返し、AskUserQuestion で選択 → `--file` + `--line` で再実行 |
| 匿名関数がターゲット指定された | v1 対象外である旨をエラーで返す |
| tsconfig なし / 素の JS | 既定 compilerOptions(前述)で解析続行。HTML に解析条件を表示 |
| プロジェクトの TS が使えない(TS 7 等) | 同梱 TS 5系にフォールバック。使用バージョンを meta に記録 |
| ノード数が上限超過 | 生成は完了させ、HTML に打ち切りバナー(方向別件数・未探索 frontier)を表示 + エージェントが `--upstream-depth` / `--downstream-depth` 付き再実行を提案 |
| モノレポで隣接パッケージが境界扱いになる | v1 の既知の制約として HTML 注記に表示。`--tsconfig` での再実行を案内 |
| 検出できない動的呼び出し(イベント、DI 等) | 「検出できない呼び出しがあり得る」注記を HTML に常設 |

## テスト

### 解析スクリプト(node --test、fixture ごとにスナップショット比較)

fixtures はエッジケース別に分割する:

1. **basic** — ルーティング → サービス → ユーティリティの 3 層直接呼び出し
2. **callback** — `app.post(path, handler)` / `items.map(fn)` / 高階関数への名前渡し(`callback-passed` エッジと上流継続の検証)
3. **cycle** — 相互再帰・循環(方向別 distance と無限ループ回避の検証)
4. **duplicate-symbols** — 同一ファイル内の同名メソッド・同名関数(ID 衝突と曖昧性解決の検証)
5. **barrel** — re-export / バレル経由 import(元宣言への解決の検証)
6. **plain-js** — tsconfig なしの素の JS プロジェクト
7. **truncation** — `--max-nodes` 小さめ指定での打ち切り情報の検証
8. **xss** — `</script>` や HTML 断片を含むソースコード(エスケープの検証)

### HTML/UI

- **Playwright smoke test(自動)**: ①ページがエラーなくロードされグラフが描画される ②展開バッジで展開できる ③検索でノードにフォーカスする ④XSS fixture のコードが実行されない(alert 等が発火しない)の 4 点のみ。
- 詳細な見た目・操作感は fixture グラフをブラウザで手動確認。
- **実プロジェクト検証**: 完成後、実際の TS プロジェクト 1 つ(Express 等のコールバック登録型ルーティングを含むもの)で `/func-understand` を通し実行して体験を確認。

## スコープ外(将来検討)

- TS/JS 以外の言語対応(LSP 経由の多言語化)
- フレームワークアダプタ(Express ルート定義の専用検出、Next.js file-based route のエントリポイント合成)
- project references / 複数 tsconfig の横断解析(ProjectService 相当、declarationMap ソースリダイレクト)
- エディタで開くリンク(vscode:// 連携)
- ローカルサーバー + ダッシュボード形態(オンデマンド追加解析、エディタ連携)
- 距離2超ノードの要約オンデマンド生成
- 大規模グラフ向けの性能ベンチマーク(疎・密・循環 100/300 ノード)

## レビュー履歴

- 2026-07-28: Claude サブエージェント(TS 5.9.3 での実挙動検証付き、指摘10件)+ Codex(TS 6.0.3 型定義・LanguageService 検証、指摘14件)による設計レビューを実施。両者一致の critical 2 件(TS バージョン戦略の破綻、コールバック登録での上流断絶)を含む客観的改善を反映。仕様判断 4 件(参照エッジ v1 採用 / ライブラリインライン埋め込み / 要約は距離2以内 / smoke test 追加)はユーザー承認済み。
