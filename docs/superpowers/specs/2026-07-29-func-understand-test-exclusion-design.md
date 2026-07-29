# func-understand: テスト関連ファイル除外 設計スペック

- 日付: 2026-07-29
- 対象: `plugins/cc-func-understand`(v0.2.0 フォローアップ、issue #5)
- 起点: 実利用で上流(呼び出し元)に `*.test.ts` / `*.spec.ts` などのテストファイル群が大量に並び、`create*` 系関数への長距離エッジがグラフのノイズ・エッジ交差の主要因になっている。

## 問題

テストファイルは tsconfig の対象に含まれることが多く、`isInternal` 判定では本番コードと区別できない。上流探索でテストからの呼び出しが大量にノード化され、本来見たい「本番コードの呼び出し関係」が埋もれる。

テストファイルの命名・配置規則はリポジトリごとに異なる(jest / vitest / mocha / Playwright / Cypress / Deno などで testMatch のデフォルトも設定方法も違う)ため、汎用パターンの決め打ちでは誤爆・漏れが避けられない。

## 決定事項

### 1. リポ別の除外定義ファイル方式(ユーザー提案)

汎用パターンのハードコードではなく、**解析対象リポごとに除外定義ファイルを1度生成し、以降はそれに従って除外する**。

- パス: `<project-root>/.func-understand.json`(解析対象リポのルート)
- **git 追跡外が前提**: チーム共有物ではなくローカル生成物。生成時に `.git/info/exclude` へ `.func-understand.json` を追記する(ローカル限定の除外なのでリポの共有ファイルを汚さない。共有したい人は各自 exclude から外してコミットすればよい)。git リポでない場合・既に記載がある場合は追記しない。
- 形式(将来の設定項目にも使える汎用名。`testExclude` はその最初のキー):

```json
{
  "testExclude": [
    "**/*.test.*",
    "**/__tests__/**",
    "e2e/**"
  ]
}
```

- glob は projectRoot からの**相対パス・posix 区切り**でマッチする。サポート構文は `**` / `*` / `?` / `{a,b}` のみ。jest の extglob(`?(*.)` 等)は AI が転記時にこの部分集合へ展開する(SKILL.md に明記)。
- 書き込み不適切なリポ(読み取り専用・第三者リポ等)では scratchpad に生成し、`--test-exclude <path>` で明示的に渡す(HTML 出力の既存フォールバックルールと同じ扱い)。

### 2. 定義ファイルの生成は AI(スキル手順)、除外の適用はスクリプト

責務分担は既存方針(グラフは script の出力が正、AI は summary のみ)を踏襲する。「テスト設定を読んで解釈する」という曖昧さのある仕事はスキル手順に置き、スクリプトは「定義ファイルどおりに除外する」だけの決定的な処理に保つ。

**生成手順(SKILL.md に追加。定義ファイルが無い場合の初回のみ)**:

1. リポのテスト設定を調査する: `jest.config.*` / `vitest.config.*` / `playwright.config.*` / `cypress.config.*` / `package.json`(`test` スクリプト・`jest` フィールド)/ tsconfig の `exclude` など。
2. 見つかった設定の testMatch / include / specPattern をサポート構文の glob に転記する。
3. 見つからなければ後述のフォールバック既定セットを書き込む。
4. `.git/info/exclude` に追記する(上記の条件で)。

**再生成はしない**: テスト設定が変わったらユーザーが「作り直して」と指示するか、ファイルを削除すれば次回実行時に再生成される(SKILL.md に記載)。

### 3. フォールバック既定セット

テスト設定が見つからないリポ用。主要ツールのデフォルト検出パターンを調査(2026-07-29、jest / vitest / node:test / mocha / AVA / Playwright / Cypress / Deno / Jasmine / NestJS / Angular の公式ドキュメント・ソース)し、誤爆リスク別に4層へ分類した結果の**第1〜3層**を採用する:

```json
{
  "testExclude": [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
    "**/*-test.*",
    "**/*.cy.*",
    "**/*.e2e-spec.*",
    "**/__tests__/**",
    "**/__mocks__/**",
    "**/__snapshots__/**",
    "**/__fixtures__/**",
    "**/__helpers__/**",
    "**/test/**",
    "**/tests/**",
    "**/spec/**",
    "**/e2e/**",
    "**/cypress/**"
  ]
}
```

第4層(誤爆リスク中〜高)は含めない: ファイル名単体の `test.ts`(本番の「テスト環境用クライアント」等と衝突)、`test-*` プレフィックス(`test-id-generator.ts` 等の本番コードと衝突)、裸の `fixtures/` / `mocks/` / `helpers/`(本番コードで広く使用)、`*.stories.*` / `*.bench.*`(テストではない)。定義ファイルはユーザーが編集できるので、必要なリポでは足せばよい。

### 4. スクリプト側の変更

- **新モジュール `lib/test-file-matcher.mjs`**(依存ゼロ維持):
  - glob → 正規表現の変換(サポート構文のみ。単体テストで担保)
  - `.func-understand.json` の読み込み(`testExclude` 配列を取り出す。ファイル無し・キー無し・不正 JSON は「除外なし」として扱い、不正 JSON のみ stderr に警告)
  - `isTestFile(relPath)` 相当のマッチャー生成
- **`analyze-callgraph.mjs`**:
  - デフォルトで `<project-root>/.func-understand.json` を自動読み込み
  - `--include-tests`: 除外を完全無効化(定義ファイルを読み込まない)
  - `--test-exclude <path>`: 定義ファイルのパスを明示指定(読み取り専用リポのフォールバック用)
- **`graph-builder.mjs` の `stepDirection`**: stdlib 除外と同じ位置(maxNodes チェックより**前**)に「peerItem のファイルがテストパターンにマッチしたら continue(ノードもエッジも作らない)」を追加。
  - maxNodes チェックより前に置く理由は stdlib と同一: 後ろに置くとテストファイルが `truncation.frontier` に積まれ、「上限で打ち切られた」という誤った案内が出る。
  - マッチ対象は `path.relative(projectRoot, file)`(posix 区切りに正規化)。projectRoot 外(`..` 始まり)はマッチさせない。
  - マッチャーは `buildGraph` の opts 経由で渡し、`createGraphContext` が ctx に保持する(除外無効時は常に false を返すマッチャー)。
- **`callback-edges.mjs` の `addCallbackEdges`**: `findReferences` ベースの別経路でもテストファイル由来のノードが作られる(テスト内で対象関数を名前渡しするケース。stdlib のときは内部宣言しか扱わないため不要だったが、テストファイルは内部なのでこの経路を通る)。参照の `ref.fileName` が ctx のマッチャーにマッチしたら、frontier 計上より前に skip する。
- **起点がテストファイル内の場合**: 解析開始時にターゲットのファイルを判定し、マッチしたらその実行では除外を丸ごと無効化する。テスト関数を明示的に解析したい意図が明白で、呼び出し先のテストヘルパー群も見せるべき情報のため。stderr に「起点がテストファイルのため除外を無効化」と1行出す。

### 5. スコープ外(変えないこと)

- ビューア(`templates/`)の表示トグルは作らない(issue #5 の決定事項。除外されたノードは JSON に入らないので UI 対応不要)。
- 定義ファイルの自動再生成・鮮度チェックはしない(YAGNI)。
- stdlib 除外(v0.2.0)の挙動は変えない。テスト除外はその後段に追加するだけ。

## テスト

- **`test-file-matcher` の単体テスト**(`node --test`):
  - glob 変換: `**`(0個以上のセグメント)/ `*`(セグメント内)/ `?` / `{a,b}` の各構文
  - `**/*.test.*` が `foo.test.ts` と `src/a/foo.test.tsx` にマッチし、`latest.ts` にマッチしない
  - `**/test/**` が `test/helper.ts` と `src/test/x.ts` にマッチし、`testing/x.ts` や `abtest/x.ts` にマッチしない(セグメント完全一致)
  - 定義ファイル読み込み: ファイル無し / `testExclude` 無し / 不正 JSON → 除外なし
- **統合 fixture `test/fixtures/test-exclusion/`**:
  - src の関数を `__tests__/*.test.ts` と `test/helper.ts` から呼ぶ構成で:
    - (a) デフォルト(定義ファイルあり)でテスト由来ノード・エッジが存在しない
    - (b) `--include-tests` で従来どおり全ノードが出る
    - (c) 起点をテストファイル内の関数にすると除外が無効化される
    - (d) `truncated` が発生しない(frontier にテストファイルが積まれない)
    - (e) テスト内で対象関数を名前渡しするケース(callback-passed 経路)でもテスト由来ノードが作られない
- 既存 unit + Playwright smoke がすべて green のまま。

## ドキュメント

- SKILL.md: 定義ファイル生成手順(初回)、`--include-tests` / `--test-exclude` の使い分け、サポートする glob 構文、フォールバック既定セット、再生成の方法(削除 or 指示)を追記。
- README「既知の制約」: テストファイルはデフォルトで除外されること、`.func-understand.json` で調整できることを追記。

## 経緯メモ

- issue #5 起票時は stdlib 除外と同様の「パターン決め打ち + 完全除外」を想定していたが、ブレスト中にユーザーから「テスト設定はリポごとに違うので、AI がリポの設定を確認して定義ファイルを1度生成し、以降はそれに従う」方式の提案があり、こちらを採用(2026-07-29)。
- issue #5 の「表示トグルは作らない」はビューア側の話であり、CLI の `--include-tests`(定義ファイルを読まずに全生成)は本ブレストでの新規決定。
- 除外パターンの網羅調査は Web 調査エージェントで実施(jest / vitest / node:test / mocha / AVA / Playwright / Cypress / Deno / Jasmine / NestJS / Angular / Storybook の公式ドキュメント)。結果はフォールバック既定セットの根拠として本スペックに反映。
- 起点がテストファイル内の場合の「除外丸ごと無効化」、glob 配列フォーマット、`.git/info/exclude` 方式は AskUserQuestion で確認済み。
