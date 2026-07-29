# cc-func-understand: 詳細パネルの開閉とドラッグリサイズ 設計

- 日付: 2026-07-29
- 対象 issue: #7
- 対象バージョン: v0.4.0 の次(v0.5.0 想定)

## 背景

生成 HTML ビューアの右側詳細パネル(AI 要約・シグネチャ・コードプレビュー)は固定幅 420px で常時表示され、グラフの表示領域を圧迫する。ユーザー要望は (a) 開閉可能にする、(b) 横幅を調整可能にする、の2点。

自己完結 HTML の制約(外部ライブラリ CDN 不使用)があるため、素の JS/CSS で実装する。

## 決定事項(ブレスト結果)

| 論点 | 決定 |
|---|---|
| 開閉トグルの UI | グラフとパネルの境界に置くハンドルボタン(バナーにボタンは追加しない) |
| 閉状態でノードをタップ | パネルを自動で開く |
| 状態の永続化 | しない(リロードで初期状態: 開・420px に戻る) |
| 実装方式 | ディバイダ要素 + Pointer Events で `flex-basis` を制御(CSS `resize` プロパティは不採用: ハンドル位置が右下隅固定で、右端パネルを左方向へ広げる操作と相性が悪い) |

## 設計

### 1. レイアウト(viewer.html / viewer.css)

`<main>` 内の `#graph` と `#detail` の間にディバイダを追加する:

```html
<main>
  <div id="graph"></div>
  <div id="divider"><button id="detail-toggle" type="button">▶</button></div>
  <aside id="detail"></aside>
</main>
```

- `#divider`: 幅 8px の縦バー。`cursor: col-resize`。ホバーで背景色を変え、ドラッグ可能であることを示す。
- `#detail-toggle`: ディバイダ中央に縦位置で配置する小ボタン。開いているとき「▶」(閉じる方向)、閉じているとき「◀」(開く方向)。`aria-label`(「詳細パネルを閉じる/開く」)と `aria-expanded` を付与する。
- 閉状態: `#detail` に `hidden` 属性を付ける(`display:none`)。ディバイダとトグルボタンは残るため再度開ける。
- `#detail` の幅: 現行の `width: 420px; flex: 0 0 420px`(viewer.css)を初期値とし、JS から `style.flexBasis` を px で更新する。クランプは min 240px / max `window.innerWidth - 320px`(グラフ領域を最低限確保)。

### 2. 挙動(viewer.js に「詳細パネルの開閉・リサイズ」セクションを追加)

- **開閉**: `#detail-toggle` の click で `#detail` の `hidden` を反転し、矢印文字と `aria-expanded` を更新する。開閉後に `cy.resize()` を呼び、cytoscape のキャンバスサイズをコンテナに追従させる(呼ばないと描画領域とヒットテストがずれたままになる)。
- **リサイズ**: `#divider` の `pointerdown` で開始し `setPointerCapture` を使う。`pointermove` で `window.innerWidth - clientX` から幅を計算し、クランプして `flex-basis` に適用する。`pointerup` で終了し `cy.resize()` を呼ぶ。ドラッグ中は `body` に `user-select: none` を適用してテキスト選択を抑止する。パネルが閉じているときはドラッグを開始しない。
- **誤クリック防止**: トグルボタン上の `pointerdown` は伝播を止め、ボタンクリックがドラッグ開始と競合しないようにする。
- **自動オープン**: ノード tap ハンドラ(`initCy()` 内)で、パネルが閉じていれば開いてから `showDetail(id)` を呼ぶ。初期化時の `showDetail(graph.target)` は変更しない(初期状態は「開」なので実質影響なし)。

### 3. エッジケース

- ウィンドウ縮小で現在幅が max クランプを超えた場合: 次のリサイズ操作時に再クランプされる。`window.resize` の監視は行わない(YAGNI)。
- ドラッグ中に `pointercancel` が発生した場合は `pointerup` と同じ終了処理を行う。

### 4. テスト(scripts/test/smoke.spec.mjs に追加)

- ⑧ トグルボタンで閉じる → `#detail` が非表示になり、再クリックで表示に戻る。
- ⑨ 閉じた状態でノード tap → パネルが自動で開き、該当ノードの詳細が表示される。
- ⑩ ディバイダをドラッグ(`mouse.down/move/up`) → `#detail` の幅が変わる。
- 既存①〜⑦への影響: 初期状態が「開」のままなので前提は壊れない(④ の `#detail pre code` テキスト検証も従来どおり通る)。

## スコープ外

- 開閉状態・幅の localStorage 永続化
- バナーへのトグルボタン追加
- パネル最小化時のアイコン化・オーバーレイ表示などの発展 UI
