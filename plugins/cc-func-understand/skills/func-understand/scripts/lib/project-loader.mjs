import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next']);

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkFiles(path.join(dir, entry.name), acc);
    } else if (DEFAULT_EXTS.includes(path.extname(entry.name))) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

export function loadProject(ts, projectRoot, tsconfigOverride) {
  const configPath = tsconfigOverride
    ? path.resolve(projectRoot, tsconfigOverride)
    : (ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json') ?? null);

  let fileNames, options;
  if (configPath) {
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error) throw new Error(`tsconfig の読み込みに失敗: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
    fileNames = parsed.fileNames;
    options = parsed.options;
  } else {
    // スペック既定: allowJs: true, checkJs: false, module: esnext, moduleResolution: bundler, jsx: preserve
    options = {
      allowJs: true, checkJs: false,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
    };
    fileNames = walkFiles(projectRoot);
  }

  const host = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => '0',
    getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
    getCurrentDirectory: () => projectRoot,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    readFile: ts.sys.readFile,
    fileExists: ts.sys.fileExists,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const program = service.getProgram();
  const internalSet = new Set(fileNames.map((f) => path.normalize(f)));
  return {
    service,
    program,
    fileNames,
    tsconfigPath: configPath,
    isInternal: (f) => internalSet.has(path.normalize(f)),
  };
}
