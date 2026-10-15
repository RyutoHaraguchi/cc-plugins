---
name: artifact-brainstorming
description: Use only when the user types /artifact-brainstorming or explicitly asks to run brainstorming on an artifact (「アーティファクトで壁打ちして」). Never use automatically for ordinary brainstorming.
---

# Artifact Brainstorming

superpowers:brainstorming の段階はそのまま使う。この skill は、問い・承認・設計の提示を行う場所を、図解アーティファクトの目印とポップオーバーに移すだけのもの。分類・案の比較・設計書・writing-plans への受け渡しは brainstorming に従う。手順はここに書き写さない。

## 流れ

1. **起動**: superpowers:brainstorming を起動し、分類（spike / bounded / architectural）を宣言する。
2. **図解を作る**: 対象の流れと前提を章と図でまとめる。規模に応じて薄くし、小さい題なら 1 章・図 1 枚程度にする。
   - この skill のディレクトリ（読み込み時に示される Base directory）にある `templates/page.html` をコピーし、本文・`PAGE`・`DIAGRAMS`・`QUESTIONS` だけを書き換える。図は Mermaid を使わず、`DIAGRAMS` に書く。
   - `<title>` と `<h1>` を題材に合わせて書き換える（「図解ひな形」やサンプルの文言を残さない）。
   - 最初の publish の前に、`artifact-capabilities` と `artifact-design` の skill を読み込む。
   - `capabilities: {"comments": {}}` と `icon` を付けて publish し、`ArtifactComments` の `watch` アクションで見張りを始める。
   - チャットには 1〜2 行とリンクだけ書く。
3. **理解の質疑**: ユーザーが疑問を解消する時間を取る。答えは本文に足す。「進めて」の合図を待つ。
4. **Q0**: 目的・成功基準・仮定（ユーザーが言ったことと仮定を分けて）を、図解の「目的」の言葉の目印に出す。
5. **分岐を 1 問ずつ**: 親の分岐から順に出す。書き方と置き場所は `references/questions.md` に従う。案の比較（2〜3 案）も、比較表付きの問いとして出す。
6. **ページから届いたら**: `references/loop.md` のループを回す。チャットで決まったときも同じ扱い。
7. **設計**: 図解に「設計」の章を足し、節ごとに出して承認の問いを置く。各節から根拠へ文中リンクを張る。
8. **設計書**: brainstorming の決まりどおりの場所に書く。ユーザーの指定があればそちらに書く。
9. **分かれ道**: 「チャットに戻る」か「アーティファクトで続ける」かを、チャットで聞く。AskUserQuestion は `questions.md`「チャットで問うとき」に従い、状況（設計書のパス、残り: 設計書のレビュー・承認 → writing-plans）、各選択肢を選ぶとどうなるかの具体的な説明、推奨を入れる。続けるなら、設計書の要点を図解に載せ、確認と承認までをアーティファクトで行う。
10. **実装計画へ**: チャットで writing-plans を起動し、見張りを止める。

## 常に守ること

- 問いは 1 問ずつ出す。問いは必ず文脈の中の目印に置き、セクションに並べない。
- 調べれば分かる事実は問わない。
- ケースは最初から具体例の表で示す。
- ページからの回答のあと、チャットに書くのは最大 2 行（決定を 1 文 + 次の問いへのリンク）。箇条書き・問いの再説明・publish 前の「公開します」は書かない。ユーザーがチャットで直接聞いたことへの答えはこの限りでない。
- 外部レビュー（Codex・Opus など）は、この skill の手順には入れない。ユーザーが指示したら行う。崩れた決定は、取り消しの手順で扱う。
- コンテキストが溜まったら、`references/loop.md` の引き継ぎ手順に従う。
