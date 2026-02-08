#!/bin/bash
# Claude Code PostToolUse hook: ToDo内のプランファイルをfrontmatterのplan-nameでリネーム
# ExitPlanMode 後に自動実行される

# プロジェクトルートを環境変数から取得（未設定の場合はカレントディレクトリ）
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# ToDo ディレクトリのパス
TODO_DIR="$PROJECT_DIR/.claude/plans/ToDo"

# ToDo ディレクトリが存在しない場合は何もせず終了
if [ ! -d "$TODO_DIR" ]; then
  exit 0
fi

# ToDo 内の全 .md ファイルを処理
for file in "$TODO_DIR"/*.md; do
  # ファイルが存在しない場合（globが展開されなかった場合）はスキップ
  [ -f "$file" ] || continue

  # YAML frontmatter から plan-name を抽出
  PLAN_NAME=$(awk '/^---$/{f=!f;next} f && /^plan-name:/{sub(/^plan-name:[[:space:]]*/, ""); print; exit}' "$file")

  # plan-name が見つからない場合はスキップ
  if [ -z "$PLAN_NAME" ]; then
    continue
  fi

  # リネーム先のファイルパス
  TARGET="$TODO_DIR/${PLAN_NAME}.md"

  # 既に正しい名前の場合はスキップ
  if [ "$file" = "$TARGET" ]; then
    continue
  fi

  # ファイルをリネーム
  mv "$file" "$TARGET"
done

# プラン保存後、Claudeに実装を開始しないよう指示するコンテキストを注入
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"プランファイルを ToDo/ に保存しました。ユーザーが明示的に実装を指示するまで、実装を開始しないでください。次の指示を待ってください。"}}
EOF

exit 0
