import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { escapeJsonForScript, renderHtml } from '../generate-html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// マークアップ属性としての外部参照(CDN 等)を検出する正規表現。
// ダブルクォート付き http(s) だけでなく、シングルクォート・クォート無し・
// プロトコル相対(`src="//evil.example"`)も検出できることをテストする。
const EXTERNAL_REF_PATTERN = /(src|href)\s*=\s*['"]?(https?:)?\/\//i;

test('escapeJsonForScript は script 終端と行区切り文字を無害化する', () => {
  const json = JSON.stringify({ code: '</script><script>alert(1)</script>', sep: 'a\u2028b\u2029c' });
  const escaped = escapeJsonForScript(json);
  assert.ok(!escaped.includes('</script'));
  assert.ok(!escaped.includes('<'));
  assert.ok(!escaped.includes('\u2028') && !escaped.includes('\u2029'));
  assert.deepEqual(JSON.parse(escaped), JSON.parse(json)); // JSON として等価なまま
});

test('xss fixture のグラフから生成した HTML に生の </script> が現れない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfu-html-'));
  const graphPath = path.join(dir, 'g.json');
  const htmlPath = path.join(dir, 'out.html');
  execFileSync('node', [path.join(here, '..', 'analyze-callgraph.mjs'),
    '--project', path.join(here, 'fixtures/xss'), '--function', 'renderPage', '--out', graphPath]);
  execFileSync('node', [path.join(here, '..', 'generate-html.mjs'),
    '--graph', graphPath, '--out', htmlPath, '--title', 'xss-test']);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dataSection = html.slice(html.indexOf('id="graph-data"'));
  const dataBody = dataSection.slice(dataSection.indexOf('>') + 1, dataSection.indexOf('</script>'));
  assert.ok(!dataBody.includes('<'), 'データ部に生の < が無い');
  assert.ok(html.includes('cytoscape'), 'ライブラリがインラインされている');
  // データ部(解析対象コードの断片)は任意の文字列を含みうるため検査対象から除外し、
  // それ以外の HTML(テンプレート・インラインライブラリ・アプリ JS)にのみ
  // マークアップ属性としての外部参照が無いことを確認する。
  const htmlOutsideData = html.slice(0, html.indexOf(dataBody)) + html.slice(html.indexOf(dataBody) + dataBody.length);
  assert.ok(!EXTERNAL_REF_PATTERN.test(htmlOutsideData), '外部 URL 参照(マークアップ属性)が無い');
});

test('外部 URL 検出パターンはクォート無し/シングルクォート/プロトコル相対も検出できる', () => {
  assert.ok(EXTERNAL_REF_PATTERN.test('<script src=https://evil.example/x.js></script>'), 'クォート無しを検出');
  assert.ok(EXTERNAL_REF_PATTERN.test("<link href='https://evil.example/x.css'>"), 'シングルクォートを検出');
  assert.ok(EXTERNAL_REF_PATTERN.test('<img src="//evil.example/x.png">'), 'プロトコル相対 URL を検出');
  assert.ok(EXTERNAL_REF_PATTERN.test('<script src="http://evil.example/x.js"></script>'), 'httpも検出');
  assert.ok(!EXTERNAL_REF_PATTERN.test('<div class="src-wrapper" data-href-note="none">no attr here</div>'),
    '属性名の後に = を伴わない文字列は誤検知しない');
});

test('renderHtml のプレースホルダ置換は単一パスで行われ、置換後コンテンツ内の別プレースホルダ文字列を再置換しない', () => {
  const template = '<!--__TITLE__--> / <!--__CSS__--> / <!--__DATA__--> / <!--__LIBS__--> / <!--__APP__-->';
  const html = renderHtml({
    template,
    css: 'CSS_MARKER',
    appJs: 'APP_MARKER',
    // LIBS の内容にたまたま APP プレースホルダと同じ文字列が含まれるケース(逐次 replace だと誤爆する)
    libsJs: 'LIBS_MARKER <!--__APP__--> literal text from a third-party library',
    libsCss: 'LIBSCSS_MARKER',
    graphJson: '{}',
    title: 'T',
  });
  assert.ok(html.includes('LIBS_MARKER <!--__APP__--> literal text from a third-party library'),
    'LIBS 内の生プレースホルダ様文字列は書き換えられずそのまま残る');
  assert.equal((html.match(/APP_MARKER/g) ?? []).length, 1, 'APP_MARKER は APP プレースホルダの分だけ1回のみ現れる');
});

test('renderHtml はテンプレートに既知プレースホルダが欠けていると例外を投げる', () => {
  const templateMissingApp = '<!--__TITLE__--><!--__CSS__--><!--__DATA__--><!--__LIBS__-->'; // APP が無い
  assert.throws(() => renderHtml({
    template: templateMissingApp,
    css: '',
    appJs: 'x',
    libsJs: '',
    libsCss: '',
    graphJson: '{}',
    title: 't',
  }), /APP/);
});

test('インライン済みライブラリだけで hljs の typescript ハイライトが有効になる(languages/typescript.min.js を別途足さなくてよい)', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const hljsDir = path.dirname(require.resolve('@highlightjs/cdn-assets/package.json'));
  const hljsSrc = fs.readFileSync(path.join(hljsDir, 'highlight.min.js'), 'utf8');
  const vm = await import('node:vm');
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(hljsSrc, sandbox, { filename: 'hljs-core-only.js' });
  assert.ok(sandbox.hljs.listLanguages().includes('typescript'), 'core バンドル単体で typescript が登録済み');
  assert.ok(sandbox.hljs.listLanguages().includes('javascript'), 'core バンドル単体で javascript も登録済み');
});
