---
name: setup
description: "Initialize cc-plan-flow directories and verify configuration for the current project"
disable-model-invocation: true
---

# cc-plan-flow Setup

プロジェクトに cc-plan-flow のディレクトリ構成と設定をセットアップする。

## 手順

### 1. ディレクトリの確認と作成
以下のディレクトリが存在するか確認し、なければ作成する:
- `.claude/plans/ToDo/`
- `.claude/plans/InProgress/`
- `.claude/plans/Done/`

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

### 3. サマリーの報告
セットアップ結果をまとめて報告する:
- 作成したディレクトリ
- 既に存在していたディレクトリ
- `plansDirectory` の設定状況
- 手動対応が必要な項目（あれば）
