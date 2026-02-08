---
name: plan-setup
description: "Initialize cc-plan-flow directories and verify configuration for the current project"
disable-model-invocation: true
---

# cc-plan-flow Setup

プロジェクトに cc-plan-flow のディレクトリ構成と設定をセットアップする。

## 手順

### 1. ディレクトリの確認と作成
以下のディレクトリが存在するか確認し、なければ作成する:
- `./.claude/plans/ToDo/`
- `./.claude/plans/InProgress/`
- `./.claude/plans/Done/`

各ディレクトリについて、作成したか既存だったかを記録する。

### 2. settings.json の確認
`.claude/settings.json` が存在するか確認し、`plansDirectory` 設定が含まれているかチェックする。

- `plansDirectory` が設定済みの場合: その値を表示する
- `.claude/settings.json` が存在しないか、`plansDirectory` が未設定の場合: ユーザーに以下の設定を追加するよう案内する

```json
{
  "plansDirectory": "./.claude/plans/ToDo"
}
```

注意: `.claude/settings.json` には他の設定が含まれている可能性があるため、自動で上書きしない。ユーザーに手動追加を案内する。

### 3. ルールファイルの作成
`.claude/rules/plan-lifecycle.md` が存在するか確認する。

- 存在しない場合: 以下の内容でファイルを作成する

```markdown
---
description: "Plan lifecycle management for ToDo/InProgress/Done workflow"
paths:
  - ".claude/plans/**"
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
```

- 既に存在する場合: 「ルールファイルは既に設定済みです」と表示する

### 4. サマリーの報告
セットアップ結果をまとめて報告する:
- 作成したディレクトリ
- 既に存在していたディレクトリ
- `plansDirectory` の設定状況
- ルールファイルの作成状況
- 手動対応が必要な項目（あれば）
