#!/bin/bash
# セッション開始時にプランディレクトリを自動作成するスクリプト
# SessionStart フックから呼び出される
# 冪等性あり: ディレクトリが既に存在する場合は何もしない

# プロジェクトルートを環境変数から取得（未設定の場合はカレントディレクトリ）
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# プランディレクトリのベースパス
PLANS_DIR="$PROJECT_DIR/.claude/plans"

# ToDo / InProgress / Done ディレクトリを作成（既存なら無視）
mkdir -p "$PLANS_DIR/ToDo"
mkdir -p "$PLANS_DIR/InProgress"
mkdir -p "$PLANS_DIR/Done"

# セッション開始をブロックしないよう常に正常終了
exit 0
