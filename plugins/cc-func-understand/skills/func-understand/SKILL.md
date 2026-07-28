---
name: func-understand
description: Use when the user invokes /func-understand or asks to visualize a function's call graph, callers/callees, upstream routing path, or dependency chain as an interactive HTML view for a TS/JS codebase.
---

# Function Call Graph Understanding

## Purpose

`/func-understand` は TypeScript/JavaScript プロジェクト内の 1 関数を起点に、呼び出し元(upstream)と呼び出し先(downstream)の静的呼び出しグラフを解析し、AI による日本語要約付きの自己完結インタラクティブ HTML として可視化する。

パイプラインは 4 段階:

1. 前提確認
2. 解析実行(`analyze-callgraph.mjs`)
3. AI 要約(グラフ JSON に summary を埋める)
4. HTML 生成(`generate-html.mjs`)

## 1. 前提確認

- 対象は TS/JS プロジェクトのみ。対象ディレクトリが TS/JS プロジェクトでない場合はその旨を伝えて中断する。
- `<skill>/scripts/node_modules` が存在しなければ、初回のみ `cd <skill>/scripts && npm install` を実行する。既に存在する場合は再実行しない。
- 対象関数名がユーザー入力から明確でない場合(コマンド引数無しで起動された場合など)は AskUserQuestion で対象関数名を確認する。

## 2. 解析実行

```bash
node <skill>/scripts/analyze-callgraph.mjs \
  --project <プロジェクトルート> \
  --function <関数名> \
  --out <scratchpad>/graph.json
```

必要に応じて `--file <relFile>` `--line <n>` `--tsconfig <path>` `--upstream-depth <n>` `--downstream-depth <n>` `--max-nodes <n>` を付与する。

stdout の JSON と exit code で分岐する:

- **exit 2, `status: "ambiguous"`**: `candidates` の各要素をラベル `relFile:startLine (containerName)` として AskUserQuestion で提示し、ユーザーに選ばせる。選択された候補の `relFile` と `startLine` を `--file` `--line` として付与し、同じコマンドを再実行する。
- **exit 2, `status: "not-found"`**: `suggestions` を提示し、関数名の再入力を促す(AskUserQuestion または自由入力での確認)。
- **exit 0, `status: "ok"`**:
  - `truncated: true` の場合、生成自体は続行してよいが、最終報告時に「グラフが `--max-nodes` 等の上限で打ち切られたため、`--upstream-depth`/`--downstream-depth` を指定して再実行すると全体像を確認できる」旨を提案する。
  - モノレポ構成などで期待される呼び出し元(upstream)がプロジェクト境界ノードで途切れていると思われる場合、ルート/参照先の `tsconfig.json` を `--tsconfig` に指定して再実行するよう案内する。
- **exit 1**: stderr のエラーメッセージ(不正な数値フラグなどを含む)をそのままユーザーに伝え、原因を修正して再実行する。

## 3. AI 要約

`--out` に書き出された graph.json を読み込み、以下の条件を満たすノードのみに要約を書く:

```text
min(upstreamDistance ?? Infinity, downstreamDistance ?? Infinity) <= 2  かつ  internal === true
```

- 各対象ノードに、そのコードを読んで 1〜3 行の日本語要約を作成し、ノードの `summary` フィールドに埋める。
- 対象ノードが **30 を超える**場合は、Task tool のサブエージェントに分割して要約させる(1 エージェントあたり最大 30 ノード)。各サブエージェントには対象ノードの `id` / `name` / `code` のみを渡し、`{ "id": "summary text", ... }` 形式の JSON を返させる。返ってきた要約をノードにマージする。
- **対象範囲外のノード(距離 2 超、または external/boundary ノード)の `summary` には一切触れない**。null のまま残す。
- 要約を埋め終えたら graph.json を同じパスに上書き保存する。

## 4. HTML 生成

```bash
node <skill>/scripts/generate-html.mjs \
  --graph <scratchpad>/graph.json \
  --out <project-root>/docs/func-understand/YYYY-MM-DD-HHMM-<関数名>.html \
  --title "<関数名> の呼び出しグラフ"
```

- 出力ディレクトリ `docs/func-understand/` が無ければ作成する。
- ファイル名の日時はコマンド実行時刻(ローカル時刻、`YYYY-MM-DD-HHMM` 形式)を使う。
- 生成後、`open <出力パス>` などでブラウザ表示する。
- 最終応答では生成した HTML の**絶対パス**をユーザーに報告する。

## 5. 注意

- 生成した HTML の中身を chat に貼り付けない。常にファイルパスで案内する。
- グラフ構造(ノード/エッジ/距離)の正確性はスクリプト(`analyze-callgraph.mjs`)の出力がそのまま正であり、エージェントが手で修正・追加してはならない。エージェントが行うのは `summary` フィールドの追記のみ。
- 既知の制約(ユーザーへの説明や truncated/境界ノード時の案内に利用する):
  - イベント経由・DI経由などの動的な呼び出しは検出できない(コールバックとして渡された参照のエッジのみ検出可能)。
  - project references を使うモノレポや、ビルド成果物をまたぐ呼び出しは境界ノードとして表現され、そこで経路が途切れる(`--tsconfig` の指定で改善する場合がある)。
  - 無名関数(匿名関数式)は解析対象として指定できない。
  - TypeScript 7 系のプロジェクトでは、同梱されている TypeScript 5 系にフォールバックして解析する。
