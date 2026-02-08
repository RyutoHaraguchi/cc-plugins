---
name: plan-lifecycle
description: "Plan lifecycle management for ToDo/InProgress/Done workflow. Use when entering plan mode, creating plans, approving plans, starting or completing implementation, or working with .claude/plans/ directory. Always apply these rules when plan files are involved."
---

# Plan Lifecycle Management

## ディレクトリ構成
プランは `.claude/plans/` 配下で状態管理する:
- `ToDo/` — 承認済み・未着手のプラン（plansDirectory で自動生成先）
- `InProgress/` — 実装中のプラン
- `Done/` — 完了したプラン

## プランファイルのフォーマット
プランファイルは必ず YAML frontmatter で始め、`plan-name` を定義する:
- `plan-name` は `YYYY-MM-DD_英語ケバブケース` 形式（例: `2026-02-07_add-auth-flow`）
- PostToolUse hook がこの値を読み取り、ファイルを自動リネームする
- MUST: プランファイル作成時に必ず `plan-name` を含めること
- MUST NOT: Claude がプランファイルを手動でリネームしないこと。リネームは PostToolUse hook が自動実行する。

## ライフサイクルルール

### プラン承認後
1. `plansDirectory` 設定により ToDo/ にファイルが自動生成される
2. PostToolUse hook が frontmatter の `plan-name` を読み取り自動リネームする
3. すぐに実装を開始しない — ユーザーの実装指示を待つ

### 実装開始時
1. 該当ファイルを `ToDo/` から `InProgress/` に移動する
2. 移動後、プラン内容を読み直して実装を開始する
3. InProgress に複数ファイルが存在する場合は、どのプランを対象にするか確認する

### 実装完了時
1. 該当ファイルを `InProgress/` から `Done/` に移動する
2. 「プランを Done に移動しました: <ファイル名>」と報告する

### バックログ確認
1. `.claude/plans/ToDo/` のファイル一覧を表示する
2. 各プランの概要（タイトル・日付）を簡潔にリストする
