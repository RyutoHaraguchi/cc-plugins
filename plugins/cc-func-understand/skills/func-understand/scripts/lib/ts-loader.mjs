import { createRequire } from 'node:module';
import path from 'node:path';

/** プロジェクト版 TS(createLanguageService を持つ場合のみ)→ 同梱版の順で解決する */
export function loadTypeScript(projectRoot) {
  try {
    const projectRequire = createRequire(path.join(projectRoot, 'noop.js'));
    const ts = projectRequire('typescript');
    if (typeof ts.createLanguageService === 'function') {
      return { ts, source: 'project', version: ts.version };
    }
  } catch {
    // プロジェクトに typescript が無い → 同梱版へ
  }
  const bundledRequire = createRequire(import.meta.url);
  const ts = bundledRequire('typescript');
  if (typeof ts.createLanguageService !== 'function') {
    throw new Error(`同梱 TypeScript ${ts.version} に createLanguageService がありません。scripts/ で npm install を実行してください`);
  }
  return { ts, source: 'bundled', version: ts.version };
}
