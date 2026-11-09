# cc-plugins

Claude Code プラグインマーケットプレイス。

## 利用可能なプラグイン

| プラグイン | 説明 |
|--------|-------------|
| [cc-html](./plugins/cc-html/) | `/html` でローカル HTML 成果物（operational brief）を生成。ファイル・PR・Issue・会話文脈から人間用の理解ページを作成 |
| [cc-func-understand](./plugins/cc-func-understand/) | /func-understand <関数名> で呼び出しグラフを解析し、自己完結のインタラクティブ HTML として可視化 |
| [cc-artifact-brainstorming](./plugins/cc-artifact-brainstorming/) | /artifact-brainstorming で、brainstorming の問い・承認・設計の提示を図解アーティファクト上の目印とポップオーバーで行う |
| [cc-basic-design-doc](./plugins/cc-basic-design-doc/) | /basic-design-doc で、固まった設計を決まった様式の基本設計書（HTML 1 枚）にして Artifact で公開。雛形・機械検査・独立レビューで品質と一貫性を担保し、図は SVG で埋め込む |

## 使い方

### マーケットプレイスを追加

```bash
/plugin marketplace add RyutoHaraguchi/cc-plugins
```

### プラグインをインストール

```bash
/plugin install cc-html
```

### ローカル開発

```bash
claude --plugin-dir ./plugins/cc-html
```
