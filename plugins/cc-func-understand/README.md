# cc-func-understand

TypeScript/JavaScript プロジェクト内の **1 関数を軸に呼び出しグラフを静的解析**し、自己完結の **インタラクティブ HTML** として可視化する Claude Code プラグイン。

呼び出し元(upstream: 誰がこの関数を呼んでいるか)と呼び出し先(downstream: この関数が何を呼んでいるか)を辿り、AI による日本語要約付きのグラフをブラウザで確認できます。

## 機能

- **`/func-understand` スラッシュコマンド** — 関数名を指定してグラフ解析を起動
- **`func-understand` skill** — 「この関数の呼び出し関係を可視化して」等の自然言語からも起動
- **静的解析ベース** — TypeScript Compiler API を用いた実装ファイル解析(実行時トレースではない)
- **AI 要約** — 起点から距離 2 以内の内部ノードに 1〜3 行の日本語要約を自動付与
- **自己完結 HTML** — 依存ライブラリを全てインライン化した単一 HTML ファイル(ネットワーク接続不要、~800KB程度)
- **デフォルト出力先** — `<project-root>/docs/func-understand/YYYY-MM-DD-HHMM-<関数名>.html`

## 使い方

### スラッシュコマンドで起動

```text
/func-understand getUser
/func-understand handleRequest --project ./packages/api
```

### 自然言語で起動

```text
getUser 関数の呼び出しグラフを見せて
このハンドラの呼び出し元をHTMLで可視化して
```

引数無しで起動された場合、または対象関数が特定できない場合は AskUserQuestion で対象関数を確認します。関数名が複数箇所にマッチする場合(`ambiguous`)は候補一覧から選択、見つからない場合(`not-found`)は候補の再入力を促します。

### ビューアの操作

生成されたグラフは HTML ブラウザで表示されます。グラフの操作方法:

- **ノードをタップ**: そのノードの 1 ホップ近傍以外が減光され、注目部分を追いやすくなります。背景をタップすると解除されます。

## 仕組み: 5 段階パイプライン

```text
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│ 1. 前提確認       │ --> │ 2. テスト除外定義 │ --> │ 3. 解析実行       │ --> │ 4. AI 要約        │ --> │ 5. HTML 生成      │
│ TS/JS 判定        │     │ .func-understand  │     │ analyze-callgraph │     │ 距離2以内のみ     │     │ generate-html.mjs │
│ npm install       │     │ .json を確認/生成 │     │ .mjs (Compiler    │     │ summary を付与    │     │ 自己完結 HTML     │
│ (初回のみ)        │     │ (初回のみ)        │     │ API で静的解析)   │     │ 30超は分担        │     │ を書き出し        │
└───────────────────┘     └───────────────────┘     └───────────────────┘     └───────────────────┘     └───────────────────┘
```

1. **前提確認**: 対象が TS/JS プロジェクトであることを確認し、`scripts/node_modules` が無ければ `npm install` を実行(初回のみ)。
2. **テスト除外定義の確認・生成**: `<project-root>/.func-understand.json` が無ければ、リポのテスト設定(jest / vitest / Playwright 等)から除外パターンを推定して生成する(初回のみ)。既にあればそのまま使う。
3. **解析実行**: `analyze-callgraph.mjs` が TypeScript Compiler API でプロジェクトを読み込み、指定関数を起点に呼び出しグラフ(ノード/エッジ)を JSON として出力。テスト関連ファイルはデフォルトで除外される。関数名が曖昧または未検出の場合は候補を返して中断する(exit code 2)。
4. **AI 要約**: 起点から `upstreamDistance`/`downstreamDistance` が 2 以内かつ内部(プロジェクト内)ノードにのみ、コードを読んで日本語の短い要約を書き加える。対象範囲外のノードには触れない。
5. **HTML 生成**: `generate-html.mjs` がグラフ JSON からインタラクティブな自己完結 HTML(Cytoscape.js によるグラフ表示、コードプレビュー、要約表示を内蔵)を生成する。

## 既知の制約

- **動的な呼び出し**: イベントリスナー登録・DI コンテナ経由の解決など、実行時にしか決まらない呼び出しは検出できない。コールバックとして渡された関数参照のエッジのみ検出可能。
- **標準ライブラリの呼び出しは表示されない**: `Array.prototype.push` などの TypeScript 標準ライブラリと、`fs.readFileSync` などの Node 組み込み(`@types/node` 解決)への呼び出しはノード化されない(独自定義コードに焦点を当てるため)。npm パッケージへの呼び出しは境界ノードとして表示される。
- **テスト関連ファイルはデフォルトで除外される**: 初回実行時に対象リポのテスト設定(jest / vitest / Playwright 等)から除外パターンを推定し、`<project-root>/.func-understand.json` に保存する(git 追跡外・ローカル生成物)。以降はこの定義に従い `*.test.ts` や `__tests__/` などがグラフから除外される。テスト込みで解析したい場合は `--include-tests`、パターンを調整したい場合は `.func-understand.json` の `testExclude` を編集する。起点関数がテストファイル内にある場合は除外が自動で無効化される。
- **project references / ビルド成果物をまたぐ呼び出し**: モノレポ構成で `tsconfig.json` の `references` を跨ぐ呼び出しや、ビルド後の成果物経由の呼び出しは境界ノードとして表現され、そこで経路が途切れる。`--tsconfig` で対象の tsconfig を明示すると改善する場合がある。
- **匿名関数**: 名前を持たない関数式・アロー関数は解析対象として直接指定できない。
- **TypeScript 7 系**: プロジェクトが TypeScript 7 系を使用している場合、同梱の TypeScript 5 系にフォールバックして解析する(解析結果に軽微な差異が生じ得る)。

## 必要環境

- Node.js 18 以上
- 解析対象が TypeScript/JavaScript プロジェクトであること

## インストール

### マーケットプレイス経由

```bash
/plugin marketplace add RyutoHaraguchi/cc-plugins
/plugin install cc-func-understand
```

### ローカルテスト

```bash
claude --plugin-dir ./plugins/cc-func-understand
```

## 出力例

```text
HTML artifact created: /path/to/project/docs/func-understand/2026-07-28-1430-getUser.html
Summary: getUser の呼び出し元 3 件・呼び出し先 5 件を含むグラフ(要約付き)
```

## 変更履歴

- v0.4.0: グラフレイアウトを整理(issue #6)。dagre を align:DL + nodeSep:20 に調整、エッジを taxi ルーティングに変更、ノード選択時の近傍フォーカス(減光)を追加。
- v0.3.0: テスト除外の自動読み込みと --include-tests / --test-exclude オプションを追加。
- v0.2.0: AI 要約の複数エッジ対応、距離3以上での分担処理。
- v0.1.0: 初版リリース。
