# cc-plan-flow

プランファイルを **ToDo → InProgress → Done** のライフサイクルで管理する Claude Code プラグイン。

## 機能

- **ディレクトリ自動作成** — セッション開始時に `.claude/plans/{ToDo,InProgress,Done}/` を自動作成（SessionStart hook）
- **プランファイル自動リネーム** — プランモード終了時、YAML frontmatter の `plan-name` でファイルを自動リネーム（PostToolUse hook）
- **ライフサイクルルール** — Claude がプラン関連の作業時に自動適用する Skill。ToDo → InProgress → Done のフローを強制
- **セットアップ確認** — `/cc-plan-flow:setup` で現在のプロジェクトの設定状態を確認

## インストール

### マーケットプレイス経由

```bash
# マーケットプレイスを追加
/plugin marketplace add RyutoHaraguchi/cc-plugins

# プラグインをインストール
/plugin install cc-plan-flow
```

### ローカルテスト

```bash
claude --plugin-dir ./plugins/cc-plan-flow
```

## セットアップ

唯一の手動設定として、プロジェクトの `.claude/settings.json` に以下を追加してください:

```json
{
  "plansDirectory": "./.claude/plans/ToDo"
}
```

または `/cc-plan-flow:setup` を実行すると、設定状態の確認とガイドが表示されます。

## ワークフロー

1. **プランモードに入る** — Claude Code のプランモードでプランを作成
2. **プランを書く** — YAML frontmatter に `plan-name` を含める:
   ```markdown
   ---
   plan-name: 2026-02-08_add-user-dashboard
   ---
   # Plan: ユーザーダッシュボードの追加
   ...
   ```
3. **プランモードを終了** — プランが `ToDo/` に保存され、`plan-name` の値で自動リネームされる
4. **実装** — 実装開始時に `ToDo/` から `InProgress/` に移動
5. **完了** — 実装完了確認後に `InProgress/` から `Done/` に移動

## オプション: ルールの常時適用

プランライフサイクルルールを常に有効にしたい場合は、プロジェクトに `.claude/rules/plan-lifecycle.md` を作成してください。Skill の自動呼び出しに頼らず、ルールとして常時ロードされます。
