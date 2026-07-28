#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const TEMPLATE_DIR = path.join(here, '..', 'templates');

/**
 * グラフ JSON 文字列を <script type="application/json"> に埋め込んでも安全な形に無害化する。
 * - `<` は `<` にして `</script>` によるタグ終端攻撃を防ぐ
 * - U+2028 / U+2029 (行区切り文字) はエスケープして JS パーサ差異の影響を避ける
 * いずれも JSON としての意味は変えない(JSON.parse した結果は元と等価)。
 */
export function escapeJsonForScript(json) {
  return json
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * package.json を起点にパッケージのディレクトリを解決する。
 * 一部パッケージ(例: cytoscape)は package.json の "exports" が "./package.json" サブパスを
 * 公開しておらず require.resolve が失敗するため、その場合はエントリポイントの解決結果から
 * `node_modules/<pkg>/` を辿ってパッケージルートを逆算するフォールバックを行う。
 */
function resolvePkgDir(pkgName) {
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    return path.dirname(pkgJsonPath);
  } catch {
    const entryPath = require.resolve(pkgName);
    const marker = path.join('node_modules', ...pkgName.split('/')) + path.sep;
    const idx = entryPath.lastIndexOf(marker);
    if (idx === -1) {
      throw new Error(`パッケージディレクトリを解決できません: ${pkgName}`);
    }
    return entryPath.slice(0, idx + marker.length - 1);
  }
}

/** インライン対象のライブラリ本体(JS)を、決められた順序で読み込む。 */
function readLibraryScripts() {
  const cytoscapeDir = resolvePkgDir('cytoscape');
  const dagreDir = resolvePkgDir('dagre');
  const cytoscapeDagreDir = resolvePkgDir('cytoscape-dagre');
  const hljsDir = resolvePkgDir('@highlightjs/cdn-assets');

  const files = [
    path.join(cytoscapeDir, 'dist', 'cytoscape.min.js'),
    path.join(dagreDir, 'dist', 'dagre.min.js'),
    path.join(cytoscapeDagreDir, 'cytoscape-dagre.js'),
    path.join(hljsDir, 'highlight.min.js'),
    path.join(hljsDir, 'languages', 'typescript.min.js'),
  ];

  return { files, hljsDir };
}

/** ライブラリ JS 群を `;\n` 区切りで連結する(ASI 問題の回避)。 */
function buildInlineLibs() {
  const { files, hljsDir } = readLibraryScripts();
  const scripts = files.map((f) => fs.readFileSync(f, 'utf8'));
  const css = fs.readFileSync(path.join(hljsDir, 'styles', 'github-dark.min.css'), 'utf8');
  return { libsJs: scripts.join(';\n'), libsCss: css };
}

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      graph: { type: 'string' },
      out: { type: 'string' },
      title: { type: 'string' },
    },
  });
  return values;
}

function escapeHtmlText(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * viewer.html テンプレートのプレースホルダを埋める。
 * String.prototype.replace はドル記号を特殊解釈するため、必ず置換関数を使う。
 */
export function renderHtml({ template, css, appJs, libsJs, libsCss, graphJson, title }) {
  const dataScript = `<script type="application/json" id="graph-data">${escapeJsonForScript(graphJson)}</script>`;

  return template
    .replace('<!--__TITLE__-->', () => escapeHtmlText(title))
    .replace('<!--__CSS__-->', () => `${libsCss}\n${css}`)
    .replace('<!--__DATA__-->', () => dataScript)
    .replace('<!--__LIBS__-->', () => libsJs)
    .replace('<!--__APP__-->', () => appJs);
}

export async function main(argv) {
  const args = parseCliArgs(argv);
  if (!args.graph || !args.out) {
    throw new Error('--graph, --out は必須です');
  }

  const graphPath = path.resolve(args.graph);
  const graphJson = fs.readFileSync(graphPath, 'utf8');
  const graph = JSON.parse(graphJson);
  const title = args.title ?? graph.target ?? 'cc-func-understand';

  const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'viewer.html'), 'utf8');
  const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'viewer.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(TEMPLATE_DIR, 'viewer.js'), 'utf8');
  const { libsJs, libsCss } = buildInlineLibs();

  const html = renderHtml({ template, css, appJs, libsJs, libsCss, graphJson, title });

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, html);
  process.stdout.write(`${JSON.stringify({ status: 'ok', out: outPath })}\n`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
