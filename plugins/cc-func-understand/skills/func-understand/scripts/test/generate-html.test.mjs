import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { escapeJsonForScript } from '../generate-html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

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
  assert.ok(!/src\s*=\s*"https?:/.test(html) && !/href\s*=\s*"https?:/.test(html), '外部 URL 参照が無い');
});
