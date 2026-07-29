#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTypeScript } from './lib/ts-loader.mjs';
import { loadProject } from './lib/project-loader.mjs';
import { resolveTarget } from './lib/target-resolver.mjs';
import { buildGraph } from './lib/graph-builder.mjs';
import { addCallbackEdges } from './lib/callback-edges.mjs';

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      function: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'string' },
      tsconfig: { type: 'string' },
      'upstream-depth': { type: 'string' },
      'downstream-depth': { type: 'string' },
      'max-nodes': { type: 'string' },
      out: { type: 'string' },
    },
  });
  return values;
}

/**
 * tsconfig を JSONC 対応(コメント・末尾カンマ許容)で読み込んで references の有無を判定する。
 * 実プロジェクトの tsconfig はコメント/末尾カンマを含むことが多く、素の JSON.parse では
 * 黙って失敗し project-references 検出が漏れるため、project-loader.mjs と同じ
 * `ts.readConfigFile`(TypeScript 本体の JSONC パーサ)を再利用する。
 */
function buildLimitations(ts, tsconfigPath) {
  const limitations = ['dynamic-calls'];
  if (tsconfigPath) {
    try {
      const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!error && config && Object.prototype.hasOwnProperty.call(config, 'references')) {
        limitations.push('project-references');
      }
    } catch {
      // tsconfig が読めない場合は project-references 判定をスキップする
    }
  }
  return limitations;
}

function stripSelection(node) {
  const { _selection, ...rest } = node;
  return rest;
}

/** CLI 数値オプションを検証付きでパースする。空/未指定なら undefined、不正値は例外。 */
function parseIntOption(name, raw) {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} は数値で指定してください(受け取った値: "${raw}")`);
  }
  return n;
}

export async function main(argv) {
  const args = parseCliArgs(argv);

  if (!args.project || !args.function || !args.out) {
    throw new Error('--project, --function, --out は必須です');
  }

  const projectRoot = path.resolve(args.project);
  const { ts, source: tsSource, version: tsVersion } = loadTypeScript(projectRoot);
  const proj = loadProject(ts, projectRoot, args.tsconfig);

  if (proj.fileNames.length === 0) {
    throw new Error(
      'tsconfig が solution-style(files: [] + references のみ)の可能性があります。' +
        '--tsconfig で参照先の設定を指定して再実行してください(例: --tsconfig tsconfig.app.json)。'
    );
  }

  const line = parseIntOption('--line', args.line);
  const resolution = resolveTarget(ts, proj, { functionName: args.function, file: args.file, line }, projectRoot);

  if (resolution.status === 'ambiguous') {
    process.stdout.write(`${JSON.stringify({ status: 'ambiguous', candidates: resolution.candidates })}\n`);
    process.exitCode = 2;
    return;
  }
  if (resolution.status === 'not-found') {
    process.stdout.write(`${JSON.stringify({ status: 'not-found', suggestions: resolution.suggestions })}\n`);
    process.exitCode = 2;
    return;
  }

  const maxNodes = parseIntOption('--max-nodes', args['max-nodes']);
  const upstreamDepth = parseIntOption('--upstream-depth', args['upstream-depth']);
  const downstreamDepth = parseIntOption('--downstream-depth', args['downstream-depth']);

  const buildOpts = { projectRoot };
  if (maxNodes != null) buildOpts.maxNodes = maxNodes;
  if (upstreamDepth != null) buildOpts.upstreamDepth = upstreamDepth;
  if (downstreamDepth != null) buildOpts.downstreamDepth = downstreamDepth;

  let graph = buildGraph(ts, proj, resolution.declaration, buildOpts);
  graph = addCallbackEdges(ts, proj, graph, { projectRoot });

  graph.meta = {
    tsVersion,
    tsSource,
    tsconfig: proj.tsconfigPath ? path.relative(projectRoot, proj.tsconfigPath) : null,
    limitations: buildLimitations(ts, proj.tsconfigPath),
  };
  graph.nodes = graph.nodes.map(stripSelection);
  delete graph._ctx;

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2));

  process.stdout.write(
    `${JSON.stringify({ status: 'ok', nodes: graph.nodes.length, edges: graph.edges.length, truncated: Boolean(graph.truncation), out: outPath })}\n`
  );
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
