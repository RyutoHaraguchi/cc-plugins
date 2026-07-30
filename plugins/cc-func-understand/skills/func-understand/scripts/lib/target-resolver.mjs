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

/**
 * 指定名に一致する「関数以外の名前付き宣言」を走査する(not-a-function 判定用)。
 * resolveTarget の not-found 経路でのみ呼ばれるフォールバックで、
 * 対象は クラス・enum・interface・type エイリアス(変数は resolved-variable 側で処理)。
 * relFile はここでは計算しない(呼び出し側で projectRoot を使って解決する)。
 */
export function collectNonFunctionDeclarations(ts, proj, name) {
  const matches = [];
  for (const sf of proj.program.getSourceFiles()) {
    if (!proj.isInternal(sf.fileName)) continue;
    const visit = (node) => {
      let nameNode = null;
      let kind = null;
      let rangeNode = node;

      if (ts.isClassDeclaration(node) && node.name) {
        nameNode = node.name;
        kind = 'class';
      } else if (ts.isEnumDeclaration(node)) {
        nameNode = node.name;
        kind = 'enum';
      } else if (ts.isInterfaceDeclaration(node)) {
        nameNode = node.name;
        kind = 'interface';
      } else if (ts.isTypeAliasDeclaration(node)) {
        nameNode = node.name;
        kind = 'type';
      }

      if (nameNode && nameNode.text === name) {
        const start = sf.getLineAndCharacterOfPosition(rangeNode.getStart(sf));
        const end = sf.getLineAndCharacterOfPosition(rangeNode.getEnd());
        matches.push({
          file: sf.fileName,
          relFile: null,
          kind,
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: sf.text.slice(rangeNode.getStart(sf), rangeNode.getEnd()).split('\n')[0].slice(0, 120),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return matches;
}

/**
 * モジュールスコープの値宣言(変数・enum)から指定名に一致するものを収集する。
 * 参照グラフモード(resolved-variable)の起点解決に使う。
 * - 変数は SourceFile 直下の VariableStatement のみ(関数内ローカル・catch 節・
 *   for-of ループ変数は対象外 → 指定時は not-found に落ちる)
 * - アロー関数/関数式を初期化子に持つ変数は関数宣言(collectDeclarations 側)の
 *   担当なので対象外
 * relFile はここでは計算しない(呼び出し側で projectRoot を使って解決する)。
 */
export function collectModuleValueDeclarations(ts, proj, name) {
  const matches = [];
  const entry = (sf, rangeNode, nameNode, kind) => {
    const start = sf.getLineAndCharacterOfPosition(rangeNode.getStart(sf));
    const end = sf.getLineAndCharacterOfPosition(rangeNode.getEnd());
    return {
      file: sf.fileName,
      relFile: null,
      name: nameNode.text,
      kind,
      selectionStart: nameNode.getStart(sf),
      startLine: start.line + 1,
      endLine: end.line + 1,
      signature: sf.text.slice(rangeNode.getStart(sf), rangeNode.getEnd()).split('\n')[0].slice(0, 120),
    };
  };
  for (const sf of proj.program.getSourceFiles()) {
    if (!proj.isInternal(sf.fileName)) continue;
    for (const stmt of sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) continue;
          matches.push(entry(sf, stmt, decl.name, 'variable'));
        }
      } else if (ts.isEnumDeclaration(stmt) && stmt.name.text === name) {
        matches.push(entry(sf, stmt, stmt.name, 'enum'));
      }
    }
  }
  return matches;
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

  // 関数として見つからない場合、モジュールスコープの値宣言(変数・enum)なら
  // 参照グラフモードの起点として解決する(resolved-variable)。--file/--line の
  // 絞り込みは関数と同じルールを適用する。
  let valueDecls = collectModuleValueDeclarations(ts, proj, name).map((d) => ({
    ...d,
    relFile: path.relative(projectRoot, d.file),
  }));
  if (file) valueDecls = valueDecls.filter((d) => d.relFile === file || d.relFile.endsWith(file));
  if (line != null) valueDecls = valueDecls.filter((d) => d.startLine <= line && line <= d.endLine);
  if (valueDecls.length === 1) return { status: 'resolved-variable', declaration: valueDecls[0] };
  if (valueDecls.length > 1) return { status: 'ambiguous', candidates: valueDecls };

  const lower = name.toLowerCase();
  const suggestions = decls.filter((d) => d.name.toLowerCase().includes(lower)).slice(0, 10);

  // 関数として見つからない場合、関数以外の名前付き宣言として実在しないか確認する(issue #8)
  let nonFunctions = collectNonFunctionDeclarations(ts, proj, name).map((m) => ({
    ...m,
    relFile: path.relative(projectRoot, m.file),
  }));
  // --file/--line 指定があれば関数と同じ絞り込みを適用する
  if (file) nonFunctions = nonFunctions.filter((m) => m.relFile === file || m.relFile.endsWith(file));
  if (line != null) nonFunctions = nonFunctions.filter((m) => m.startLine <= line && line <= m.endLine);

  if (nonFunctions.length > 0) return { status: 'not-a-function', matches: nonFunctions, suggestions };

  return { status: 'not-found', suggestions };
}
