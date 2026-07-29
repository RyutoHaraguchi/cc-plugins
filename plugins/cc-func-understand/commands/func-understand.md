---
description: Analyze a function's call graph (callers/callees) and visualize it as a self-contained interactive HTML
argument-hint: "[関数名] [optional: --project <path> / --tsconfig <path>]"
---

`func-understand` skill を起動し、指定された関数を起点に呼び出しグラフを解析します。

入力: $ARGUMENTS

引数が無い場合、または対象関数名が特定できない場合は、AskUserQuestion で「どの関数を可視化するか」を確認してから解析を開始してください。

skill の指示(`skills/func-understand/SKILL.md`)に従って、前提確認 → 解析実行 → AI 要約 → HTML 生成の順に進め、`<project-root>/docs/func-understand/YYYY-MM-DD-HHMM-<関数名>.html` を生成してください。

対象プロジェクトが読み取り専用・第三者リポジトリ・その他書き込みが不適切な場合は、`<project-root>/docs/func-understand/` には書き込まず、スクラッチパッド等の作業用ディレクトリ(無ければ一時ディレクトリ)に出力し、その絶対パスを報告してください。

最終応答では生成した HTML の絶対パスと 1 文の要約のみを返します。
