# cc-plugins

Claude Code プラグインマーケットプレイス。

## 利用可能なプラグイン

| プラグイン | 説明 |
|--------|-------------|
| [cc-plan-flow](./plugins/cc-plan-flow/) | プランファイルを ToDo → InProgress → Done のライフサイクルで管理。自動リネーム・ディレクトリ自動作成付き |

## 使い方

### マーケットプレイスを追加

```bash
/plugin marketplace add RyutoHaraguchi/cc-plugins
```

### プラグインをインストール

```bash
/plugin install cc-plan-flow
```

### ローカル開発

```bash
claude --plugin-dir ./plugins/cc-plan-flow
```
