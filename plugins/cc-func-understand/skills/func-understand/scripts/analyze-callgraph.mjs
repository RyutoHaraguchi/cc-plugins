#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

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

function buildLimitations(tsconfigPath) {
  const limitations = ['dynamic-calls'];
  if (tsconfigPath) {
    try {
      const raw = fs.readFileSync(tsconfigPath, 'utf8');
      const json = JSON.parse(raw);
      if (json && Object.prototype.hasOwnProperty.call(json, 'references')) {
        limitations.push('project-references');
      }
    } catch {
      // tsconfig が読めない/JSON として不正な場合は project-references 判定をスキップする
    }
  }
  return limitations;
}

function stripSelection(node) {
  const { _selection, ...rest } = node;
  return rest;
}

export async function main(argv) {
  const args = parseCliArgs(argv);

  if (!args.project || !args.function || !args.out) {
    throw new Error('--project, --function, --out は必須です');
  }

  const projectRoot = path.resolve(args.project);
  const { ts, source: tsSource, version: tsVersion } = loadTypeScript(projectRoot);
  const proj = loadProject(ts, projectRoot, args.tsconfig);

  const line = args.line != null ? Number(args.line) : undefined;
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

  const maxNodes = args['max-nodes'] != null ? Number(args['max-nodes']) : undefined;
  const upstreamDepth = args['upstream-depth'] != null ? Number(args['upstream-depth']) : undefined;
  const downstreamDepth = args['downstream-depth'] != null ? Number(args['downstream-depth']) : undefined;

  const buildOpts = { projectRoot };
  if (maxNodes != null) buildOpts.maxNodes = maxNodes;
  if (upstreamDepth != null) buildOpts.upstreamDepth = upstreamDepth;
  if (downstreamDepth != null) buildOpts.downstreamDepth = downstreamDepth;

  let graph = buildGraph(ts, proj, resolution.declaration, buildOpts);
  graph = addCallbackEdges(ts, proj, graph, { projectRoot });

  graph.meta = {
    tsVersion,
    tsSource,
    tsconfig: proj.tsconfigPath ?? null,
    limitations: buildLimitations(proj.tsconfigPath),
  };
  graph.nodes = graph.nodes.map(stripSelection);
  delete graph._ctx;

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2));

  process.stdout.write(
    `${JSON.stringify({ status: 'ok', nodes: graph.nodes.length, edges: graph.edges.length, truncated: Boolean(graph.truncation), out: outPath })}\n`
  );
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
