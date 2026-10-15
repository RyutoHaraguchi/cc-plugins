# cc-artifact-brainstorming

brainstorming の壁打ちを、**図解アーティファクトの上で**進める Claude Code プラグイン。

チャットに選択肢だけが出ると、前後の文脈が分からず判断しにくいことがあります。このプラグインは、対象の流れを図解したアーティファクトを先に作り、問いを図や文言の中の目印から開くポップオーバーとして出します。回答はページから直接 Claude のセッションへ送れます。

## 機能

- **`/artifact-brainstorming` スラッシュコマンド**：名前で呼んだときだけ起動する（普段の brainstorming では自動で動かない）
- **superpowers:brainstorming の上に重ねる層**：分類・案の比較・設計書・実装計画への受け渡しは brainstorming に従い、問い・承認・設計の提示の場だけをアーティファクトに移す
- **図解ページのひな形**（`templates/page.html`）
  - データから draw.io 風の SVG を描く図
  - 図のノードや本文の言葉に付く目印と、その場に開くポップオーバーの問い（回答待ち／決定／取り消し／要確認）
  - 回答を送ったらすぐ折りたたむ。送れないときは理由とコピー用の文面を出す
  - 狭い画面では画面下から開き、表や図はその中だけで横スクロールする
- **受け取りループの手順**（`references/loop.md`）と、**問いの書き方**（`references/questions.md`）

## 前提

- [superpowers](https://github.com/obra/superpowers) プラグイン（`superpowers:brainstorming`）
- claude.ai の Artifact と、ページからコメントを Claude に送る `comments` 機能が使える環境

## インストール

### マーケットプレイス経由

```bash
/plugin install cc-artifact-brainstorming --marketplace RyutoHaraguchi/cc-plugins
```

Claude Code 2.1.275 より前の版では、先にマーケットプレイスを追加します。

```bash
/plugin marketplace add RyutoHaraguchi/cc-plugins
/plugin install cc-artifact-brainstorming
```

### ローカル開発

```bash
claude --plugin-dir ./plugins/cc-artifact-brainstorming
```

## 使い方

```
/artifact-brainstorming issue #123 のログイン画面の出し分け
```

1. 対象の図解がアーティファクトに公開される。疑問はコメントやチャットで解消する
2. 「進めて」と伝えると、目的・前提の確認（Q0）から、問いが図解の目印に 1 問ずつ出る
3. 目印を押して選び、「回答を送る」。文脈が足りなければ「文脈が足りない：質問する」
4. 設計を節ごとに承認し、設計書ができたら、チャットに戻るか図解で続けるかを選ぶ

## テスト

```bash
cd plugins/cc-artifact-brainstorming/skills/artifact-brainstorming
node --test tests/
```
