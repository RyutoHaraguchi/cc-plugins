/**
 * Call Hierarchy が返したシンボルの解決先ファイルを分類する。
 * 'stdlib'(TS 標準ライブラリ / Node 組み込み)はグラフのノードにしない
 * (スペック: docs/superpowers/specs/2026-07-29-func-understand-stdlib-exclusion-design.md)。
 *
 * - TS 標準ライブラリ: program.isSourceFileDefaultLibrary() の公式 API で判定する。
 *   パスのパターンマッチと違い、プロジェクト版/同梱版 TS や lib 置換パッケージでも
 *   TS 自身の認識と常に一致する。
 * - Node 組み込み(fs/path 等): @types/node の d.ts に解決される。
 *   `@types/node-fetch` 等の別パッケージを誤爆しないよう区切り文字込みで判定する。
 * - 解決先が program に無い場合はフォールバックせず 'other'(従来どおり境界ノード表示)。
 */
export function classifySymbolFile(program, file) {
  const sf = program.getSourceFile(file);
  if (sf && program.isSourceFileDefaultLibrary(sf)) return 'stdlib';
  if (file.replace(/\\/g, '/').includes('/node_modules/@types/node/')) return 'stdlib';
  return 'other';
}
