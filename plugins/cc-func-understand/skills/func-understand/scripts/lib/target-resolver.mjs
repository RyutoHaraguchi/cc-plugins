import path from 'node:path';

/**
 * proj (loadProject の戻り値) が内包する全ソースファイルを走査し、
 * 関数・メソッド・アロー関数(変数代入/プロパティ代入)の宣言を収集する。
 * relFile はここでは計算しない(呼び出し側で projectRoot を使って解決する)。
 */
export function collectDeclarations(ts, proj) {
  const decls = [];
  for (const sf of proj.program.getSourceFiles()) {
    if (!proj.isInternal(sf.fileName)) continue;
    const visit = (node) => {
      let nameNode = null;
      let kind = null;
      let containerName = null;
      let rangeNode = node;

      if (ts.isFunctionDeclaration(node) && node.name) {
        nameNode = node.name;
        kind = 'function';
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        nameNode = node.name;
        kind = 'method';
        const owner = node.parent;
        containerName =
          (ts.isClassDeclaration(owner) || ts.isClassExpression(owner)) && owner.name
            ? owner.name.text
            : null;
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        nameNode = node.name;
        kind = 'arrow';
        // 宣言範囲は VariableStatement 全体(export const foo = ... を丸ごと)
        rangeNode =
          node.parent?.parent && ts.isVariableStatement(node.parent.parent)
            ? node.parent.parent
            : node;
      } else if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        nameNode = node.name;
        kind = 'method';
      }

      if (nameNode) {
        const start = sf.getLineAndCharacterOfPosition(rangeNode.getStart(sf));
        const end = sf.getLineAndCharacterOfPosition(rangeNode.getEnd());
        decls.push({
          file: sf.fileName,
          relFile: null, // resolveTarget / 呼び出し側で projectRoot を使って埋める
          name: nameNode.text,
          containerName,
          kind,
          selectionStart: nameNode.getStart(sf),
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: sf.text.slice(rangeNode.getStart(sf), rangeNode.getEnd()).split('\n')[0].slice(0, 120),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return decls;
}

export function resolveTarget(ts, proj, { functionName, file, line }, projectRoot) {
  const name = functionName.replace(/\(\)\s*$/, '').trim();
  const decls = collectDeclarations(ts, proj).map((d) => ({
    ...d,
    relFile: path.relative(projectRoot, d.file),
  }));

  let matched = decls.filter((d) => d.name === name);
  if (file) matched = matched.filter((d) => d.relFile === file || d.relFile.endsWith(file));
  if (line != null) matched = matched.filter((d) => d.startLine <= line && line <= d.endLine);

  if (matched.length === 1) return { status: 'resolved', declaration: matched[0] };
  if (matched.length > 1) return { status: 'ambiguous', candidates: matched };

  const lower = name.toLowerCase();
  const suggestions = decls.filter((d) => d.name.toLowerCase().includes(lower)).slice(0, 10);
  return { status: 'not-found', suggestions };
}
