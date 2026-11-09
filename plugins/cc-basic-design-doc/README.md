# cc-basic-design-doc

固まった設計を、**決まった様式の基本設計書（HTML 1 枚）**にして Artifact で公開する Claude Code プラグイン。

読み手は、実装を AI に指示するエンジニアと、必要に応じてそのレビュアーです。「この 1 枚だけで設計が把握できること」と「毎回同じ形であること」を、雛形・機械検査・独立レビューで担保します。設計の議論そのもの（要件の聞き取り・案の比較）は受け持ちません。brainstorming などで方式を決めてから使います。

## 機能

- **`/basic-design-doc` スラッシュコマンド**と、「基本設計書にして」「この設計書を改訂して（URL）」の明示的な依頼で起動する
- **雛形**（`template.html`）: SIer 一般の基本設計書の構成を下敷きにした章立て
  - 表紙・改訂履歴（版数・状態・ベース commit・要旨・未決事項・承認）／1 概要／2 方式設計／3 処理設計／4 データ設計／5 例外設計／6 非機能・制約／7 テスト観点／8 検証・レビュー記録
  - 4 と 6 は該当するときだけ。省いた章は表紙に理由を書く
  - 決定（D-n）・経路（P-n）・例外（X-n）・リスク（R-n）・テスト（U-n／E-n）・未決（Q-n）の表は列が固定
  - 章タブ（`#hash` で直接開ける）、ライト／ダーク、スマホ幅に対応
  - 本文の「D-1」「図 3-1」「1.3」「7 章」は表示時に自動でリンクになり、押すとそのタブの該当箇所へ移る
- **図は SVG で埋め込む**（`scripts/render_mermaid.py`）: mermaid で書いた図を、ライト用・ダーク用の SVG にして HTML に入れる。ダウンロードした HTML やオフラインでも図が見える。構文エラーは図の番号付きで止まる
- **機械検査**（`scripts/check.py`）: 置き換え忘れ・必須の章や表の欠け・列の違い・空欄・番号の参照切れ・選択肢にない値・版数の不一致・未決が残ったままの「承認済み」・SVG にしていない図を ERROR で止める
- **品質の観点**（`quality-checklist.md`）と**独立レビュー**（`reviewer-prompt.md`）: 文脈を持たない subagent に「この文書だけで実装・レビューできるか」を読ませ、穴を「事実（調べて直す）／軽微（直して作成者判断と記録）／決定が要る（未決にして 1 問ずつ聞く）」に振り分ける

## 前提

- claude.ai の Artifact が使える環境
- Python 3（検査は標準ライブラリだけ）
- Node.js（`npx`）と Chrome または Chromium（図の SVG 化。Chrome が無ければ puppeteer が取得する。場所は環境変数 `MERMAID_CHROME` で指定できる）

## インストール

### マーケットプレイス経由

```bash
/plugin install cc-basic-design-doc --marketplace RyutoHaraguchi/cc-plugins
```

Claude Code 2.1.275 より前の版では、先にマーケットプレイスを追加します。

```bash
/plugin marketplace add RyutoHaraguchi/cc-plugins
/plugin install cc-basic-design-doc
```

### ローカル開発

```bash
claude --plugin-dir ./plugins/cc-basic-design-doc
```

## 使い方

```
/basic-design-doc docs/specs/2026-11-09-session-revocation-memo.md
```

1. 材料（会話での決定・設計メモ・issue）を読み、対象リポジトリのベース commit を決めて、現状の挙動をコードで裏取りする
2. 雛形を埋め、図を SVG にして、機械検査を ERROR 0 件まで通す
3. 自己点検と独立レビューで穴を探し、決定が要るものだけを推奨付きで 1 問ずつ聞く
4. Artifact として非公開で公開し、URL・版数・状態・残る未決・作成者判断の一覧を報告する

改訂は `/basic-design-doc <artifact URL>` で、同じ URL のまま版を上げます。

## テスト

```bash
cd plugins/cc-basic-design-doc/skills/basic-design-doc/scripts
python3 -I test_check.py
python3 -I test_render_mermaid.py
```
