# cc-html

ローカルに **HTML 成果物（operational brief）** を作成する Claude Code プラグイン。

ファイル・リンク・GitHub Issue / PR / コメント・会話コンテキスト・エージェントの出力などを、人間が短時間で理解・判断・共有できる HTML ページに再構成します。Markdown を HTML に変換するだけのツールではありません。

## 機能

- **`/html` スラッシュコマンド** — 明示的に HTML 成果物を生成
- **`html` skill** — 「HTML で〜まとめて」「ビジュアル説明を作って」等の自然言語からも起動
- **構造化された出力** — Executive summary / Current state / Visuals / Evidence / Decision points / Risks / Next actions
- **デフォルト出力先** — `<project-root>/docs/html/YYYY-MM-DD-HHMM-<slug>.html`

## インストール

### マーケットプレイス経由

```bash
/plugin marketplace add RyutoHaraguchi/cc-plugins
/plugin install cc-html
```

### ローカルテスト

```bash
claude --plugin-dir ./plugins/cc-html
```

## 使い方

### スラッシュコマンドで起動

```text
/html このPRをレビュー用にまとめて  https://github.com/owner/repo/pull/123
/html OAuth2 について学習用にまとめて pattern=learning
/html 現在のリポジトリ構成を design パターンで
```

### 自然言語で起動

```text
このIssueをHTMLで読みやすくまとめて
比較表をHTMLで作って
```

## パターン

skill が入力から推測しますが、明示的に指定もできます。

| パターン   | 用途                                 |
|-----------|--------------------------------------|
| `concept` | 難しい概念や仕組みの解説             |
| `design`  | アーキテクチャ・責務分担・トレードオフ |
| `review`  | PR・diff・Issue・コードレビュー文脈  |
| `decision`| 複数選択肢の比較と推奨                |
| `learning`| 後から振り返れる学習用ブリーフ        |
| `status`  | 進捗・ブロッカー・次のアクション      |

## 出力例

```text
HTML artifact created: /path/to/project/docs/html/2026-05-10-1430-pr-123-review.html
Summary: PR #123 のレビュー用ブリーフ（変更ファイルマップ・影響範囲・Decision points 含む）
```
