/**
 * テスト関連ファイルの除外判定(スペック:
 * docs/superpowers/specs/2026-07-29-func-understand-test-exclusion-design.md)。
 *
 * glob のサポート構文は `**` / `*` / `?` / `{a,b}` のみ(SKILL.md に明記)。
 * パターンは projectRoot からの相対パス(posix 区切り)全体にアンカーしてマッチする。
 * npm の glob 実装は使わない(スクリプトのランタイム依存ゼロ維持)。
 */

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g;

/** 1 セグメント分の glob(`**` 以外)を正規表現文字列へ変換する */
function segmentToRegExp(seg) {
  // プレースホルダを使って {a,b} を保護する
  const braceExpansions = [];
  const withBracePlaceholders = seg.replace(/\{([^}]*)\}/g, function (match) {
    braceExpansions.push(match);
    return `__BRACE_${braceExpansions.length - 1}__`;
  });

  // リテラル特殊文字をエスケープ（プレースホルダはエスケープされない）
  // * と ? を処理する際に、プレースホルダ内は保護される
  const escaped = withBracePlaceholders
    .replace(REGEX_SPECIALS, '\\$&')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');

  // ブレース拡張プレースホルダを正規表現に置き換える
  return escaped.replace(/__BRACE_(\d+)__/g, (_, index) => {
    const original = braceExpansions[parseInt(index)];
    const body = original.slice(1, -1); // { と } を除去
    return `(?:${body.split(',').join('|')})`;
  });
}

export function globToRegExp(glob) {
  const segments = glob.split('/');
  const parts = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (seg === '**') {
      // 末尾の `dir/**` は「配下の 1 個以上のセグメント」、それ以外の `**/` は
      // 「0 個以上のセグメント」(`**/test/**` が `test/helper.ts` にもマッチするように)
      parts.push(isLast ? '(?:[^/]+/)*[^/]+' : '(?:[^/]+/)*');
      continue;
    }
    parts.push(segmentToRegExp(seg) + (isLast ? '' : '/'));
  }
  return new RegExp(`^${parts.join('')}$`);
}

export function createMatcher(globs) {
  const regexps = globs.map(globToRegExp);
  return (relPath) => {
    const p = relPath.replaceAll('\\', '/').replace(/^\.\//, '');
    return regexps.some((r) => r.test(p));
  };
}
