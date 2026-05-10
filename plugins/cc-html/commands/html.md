---
description: Generate a local HTML artifact (operational brief) from files, links, PRs, or current context
argument-hint: "[target or topic] [optional: pattern=concept|design|review|decision|learning|status]"
---

`html` skill を起動し、ローカルに HTML 成果物を作成します。

入力: $ARGUMENTS

skill の指示（`skills/html/SKILL.md`）に従って、対象コンテキストを収集し、`<project-root>/docs/html/YYYY-MM-DD-HHMM-<slug>.html` を生成してください。最終応答では作成ファイルの絶対パスと 1 文の要約のみを返します。
