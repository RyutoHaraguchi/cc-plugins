/**
 * テスト関連ファイルの除外判定(スペック:
 * docs/superpowers/specs/2026-07-29-func-understand-test-exclusion-design.md)。
 *
 * glob のサポート構文は `**` / `*` / `?` / `{a,b}` のみ(SKILL.md に明記)。
 * パターンは projectRoot からの相対パス(posix 区切り)全体にアンカーしてマッチする。
 * npm の glob 実装は使わない(スクリプトのランタイム依存ゼロ維持)。
 */

import fs from 'node:fs';
import path from 'node:path';

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g;

/** 1 セグメント分の glob(`**` 以外)を正規表現文字列へ変換する。glob はエラーメッセージ用の元パターン全体 */
function segmentToRegExp(seg, glob) {
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

  // ブレース拡張プレースホルダを正規表現に置き換える。{a,b} はリテラル選択のみの
  // サポートなので、ワイルドカードは明確なエラーにし、正規表現特殊文字はエスケープする
  return escaped.replace(/__BRACE_(\d+)__/g, (_, index) => {
    const original = braceExpansions[parseInt(index)];
    const body = original.slice(1, -1); // { と } を除去
    const wildcard = body.match(/[*?]/);
    if (wildcard) {
      throw new Error(
        `testExclude パターン "${glob}" の ${original} 内でワイルドカード "${wildcard[0]}" はサポートされません({a,b} はリテラルの選択のみ)`,
      );
    }
    return `(?:${body.split(',').map((alt) => alt.replace(REGEX_SPECIALS, '\\$&')).join('|')})`;
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
    parts.push(segmentToRegExp(seg, glob) + (isLast ? '' : '/'));
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

/**
 * `.func-understand.json` から testExclude 配列を読み込む。
 * 「除外なし」への劣化は安全側(ノードが余計に出るだけ)なので、
 * ファイル無し・キー無し・型不一致は警告なしで null を返し、
 * 不正 JSON のみ warning を返す(ユーザーの編集ミスに気付けるように)。
 */
export function loadTestExclusions(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return { globs: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { globs: null, warning: `${configPath} が不正な JSON のため、テスト除外なしで解析します` };
  }
  const globs = parsed?.testExclude;
  if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string')) {
    return { globs: null };
  }
  // 末尾スラッシュ形式("test/")はセグメント末尾が空文字になりどのパスにもマッチしない
  // (サイレント no-op)ため、意図どおり配下全体を除外する "test/**" に正規化する
  return { globs: globs.map((g) => (g.endsWith('/') ? `${g}**` : g)) };
}

export function createFileExcluder(projectRoot, globs) {
  const matcher = createMatcher(globs);
  return (absPath) => {
    const rel = path.relative(projectRoot, absPath).replaceAll('\\', '/');
    if (rel === '' || rel.startsWith('..')) return false; // projectRoot 外・自身は対象にしない
    return matcher(rel);
  };
}
