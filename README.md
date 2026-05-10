# cc-plugins

Claude Code プラグインマーケットプレイス。

## 利用可能なプラグイン

| プラグイン | 説明 |
|--------|-------------|
| [cc-html](./plugins/cc-html/) | `/html` でローカル HTML 成果物（operational brief）を生成。ファイル・PR・Issue・会話文脈から人間用の理解ページを作成 |

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
