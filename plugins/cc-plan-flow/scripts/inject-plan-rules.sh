#!/bin/bash
# EnterPlanMode 時にプランライフサイクルルールを additionalContext として注入する

RULES=$(cat <<'RULES_EOF'
# Plan Lifecycle Rules（必ず遵守すること）

## プランファイルのフォーマット
- YAML frontmatter で始め、plan-name を定義する
- plan-name は YYYY-MM-DD_英語ケバブケース 形式（例: 2026-02-07_add-auth-flow）
- MUST: プランファイル作成時に必ず plan-name を含めること
- MUST NOT: Claude がプランファイルを手動でリネームしないこと。リネームは PostToolUse hook が自動実行する。

## プラン承認後
1. plansDirectory 設定により ToDo/ にファイルが自動生成される
2. PostToolUse hook が frontmatter の plan-name を読み取り自動リネームする
3. すぐに実装を開始しない — ユーザーの実装指示を待つ
RULES_EOF
)

# jq でエスケープして JSON 出力
echo "$RULES" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: .
  }
}'

exit 0
