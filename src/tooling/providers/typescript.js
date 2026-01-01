import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createToolingEntry, uniqueTypes } from './shared.js';

const createDefaultCompilerOptions = (ts) => ({
  allowJs: false,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve
});

const isWithinRoot = (rootDir, candidate) => {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
};

const resolveTsConfigPath = (ts, rootDir, toolingConfig, log) => {
  const useTsconfig = toolingConfig?.typescript?.useTsconfig !== false;
  if (!useTsconfig) return null;

  const override = toolingConfig?.typescript?.tsconfigPath;
  if (override) {
    const resolved = path.isAbsolute(override) ? override : path.join(rootDir, override);
    if (fsSync.existsSync(resolved)) return resolved;
    log(`[index] TypeScript tsconfig not found at ${resolved}; falling back.`);
    return null;
  }

  const candidates = ['tsconfig.json', 'jsconfig.json'];
  for (const candidate of candidates) {
    const found = ts.findConfigFile(rootDir, ts.sys.fileExists, candidate);
    if (!found) continue;
    if (isWithinRoot(rootDir, found)) return found;
  }
  return null;
};

const formatDiagnostic = (ts, diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic?.messageText || '', '\n');
  if (diagnostic?.file?.fileName) return `${diagnostic.file.fileName}: ${message}`;
  return message;
};

const parseTsConfig = (ts, configPath, log) => {
  if (!configPath) return null;
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile?.error) {
    log(`[index] TypeScript tsconfig error: ${formatDiagnostic(ts, configFile.error)}`);
    return null;
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );
  if (parsed?.errors?.length) {
    log(`[index] TypeScript tsconfig warnings: ${formatDiagnostic(ts, parsed.errors[0])}`);
  }
  return parsed;
};

const createTypeScriptProgram = (ts, filePaths, rootDir, toolingConfig, log) => {
  const baseOptions = createDefaultCompilerOptions(ts);
  const configPath = resolveTsConfigPath(ts, rootDir, toolingConfig, log);
  if (!configPath) {
    return { program: ts.createProgram({ rootNames: filePaths, options: baseOptions }), configPath: null };
  }

  const parsed = parseTsConfig(ts, configPath, log);
  if (!parsed) {
    return { program: ts.createProgram({ rootNames: filePaths, options: baseOptions }), configPath: null };
  }

  const options = { ...baseOptions, ...parsed.options };
  const program = ts.createProgram({
    rootNames: filePaths,
    options,
    projectReferences: parsed.projectReferences
  });
  return { program, configPath };
};

const buildTypeScriptMap = (ts, program, filePaths) => {
  const fileSet = new Set(filePaths);
  const checker = program.getTypeChecker();
  const byFile = new Map();

  const record = (fileName, name, signature, params) => {
    if (!fileName || !name || !signature) return;
    const returnType = checker.typeToString(checker.getReturnTypeOfSignature(signature));
    const paramTypes = {};
    for (const param of params || []) {
      const nameNode = param?.name;
      const paramName = nameNode && typeof nameNode.getText === 'function' ? nameNode.getText() : null;
      if (!paramName) continue;
      const paramType = checker.typeToString(checker.getTypeAtLocation(param));
      if (paramType) paramTypes[paramName] = paramType;
    }
    const fileMap = byFile.get(fileName) || {};
    if (fileMap[name]) {
      const existing = fileMap[name];
      if (!existing.returnType && returnType) existing.returnType = returnType;
      for (const [paramName, paramType] of Object.entries(paramTypes)) {
        if (!paramName || !paramType) continue;
        const existingType = existing.paramTypes?.[paramName];
        existing.paramTypes = existing.paramTypes || {};
        existing.paramTypes[paramName] = uniqueTypes([...(existingType ? [existingType] : []), paramType]).join(' | ');
      }
    } else {
      fileMap[name] = { returnType, paramTypes };
    }
    byFile.set(fileName, fileMap);
  };

  const recordFunctionLike = (fileName, name, node) => {
    const signature = checker.getSignatureFromDeclaration(node);
    if (signature) record(fileName, name, signature, node.parameters);
  };

  const getIdentifierName = (node) => (ts.isIdentifier(node) ? node.text : null);
  const isFunctionInitializer = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

  for (const sourceFile of program.getSourceFiles()) {
    if (!fileSet.has(sourceFile.fileName)) continue;
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.getText(sourceFile);
        node.members?.forEach((member) => {
          if (ts.isConstructorDeclaration(member)) {
            recordFunctionLike(sourceFile.fileName, `${className}.constructor`, member);
            return;
          }
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = getIdentifierName(member.name);
            if (methodName) recordFunctionLike(sourceFile.fileName, `${className}.${methodName}`, member);
            return;
          }
          if ((ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.name) {
            const accessorName = getIdentifierName(member.name);
            if (accessorName) recordFunctionLike(sourceFile.fileName, `${className}.${accessorName}`, member);
            return;
          }
          if (ts.isPropertyDeclaration(member) && member.name && member.initializer) {
            const propName = getIdentifierName(member.name);
            if (propName && isFunctionInitializer(member.initializer)) {
              recordFunctionLike(sourceFile.fileName, `${className}.${propName}`, member.initializer);
            }
          }
        });
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        recordFunctionLike(sourceFile.fileName, node.name.getText(sourceFile), node);
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isFunctionInitializer(node.initializer)) {
          recordFunctionLike(sourceFile.fileName, node.name.text, node.initializer);
        }
      }

      ts.forEachChild(node, (child) => visit(child));
    };
    visit(sourceFile);
  }
  return byFile;
};

async function loadTypeScript(toolingConfig, repoRoot) {
  if (toolingConfig?.typescript?.enabled === false) return null;
  const toolingRoot = toolingConfig?.dir || '';
  const resolveOrder = Array.isArray(toolingConfig?.typescript?.resolveOrder)
    ? toolingConfig.typescript.resolveOrder
    : ['repo', 'cache', 'global'];
  const lookup = {
    repo: path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
    cache: toolingRoot ? path.join(toolingRoot, 'node', 'node_modules', 'typescript', 'lib', 'typescript.js') : null,
    tooling: toolingRoot ? path.join(toolingRoot, 'node', 'node_modules', 'typescript', 'lib', 'typescript.js') : null
  };

  for (const entry of resolveOrder) {
    const key = String(entry || '').toLowerCase();
    if (key === 'global') {
      try {
        const mod = await import('typescript');
        return mod?.default || mod;
      } catch {
        continue;
      }
    }
    const candidate = lookup[key];
    if (!candidate || !fsSync.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      return mod?.default || mod;
    } catch {}
  }
  return null;
}

export async function collectTypeScriptTypes({ rootDir, chunksByFile, log, toolingConfig }) {
  const tsFiles = Array.from(chunksByFile.keys())
    .filter((file) => ['.ts', '.tsx', '.mts', '.cts'].includes(path.extname(file).toLowerCase()))
    .map((file) => path.resolve(rootDir, file));
  const uniqueTsFiles = Array.from(new Set(tsFiles));
  if (!uniqueTsFiles.length) return { typesByChunk: new Map(), fileCount: 0 };

  if (toolingConfig?.typescript?.enabled === false) {
    log('[index] TypeScript tooling disabled; skipping tooling-based types.');
    return { typesByChunk: new Map(), fileCount: uniqueTsFiles.length };
  }

  const ts = await loadTypeScript(toolingConfig, rootDir);
  if (!ts) {
    log('[index] TypeScript tooling not detected; skipping tooling-based types.');
    return { typesByChunk: new Map(), fileCount: uniqueTsFiles.length };
  }

  const { program, configPath } = createTypeScriptProgram(ts, uniqueTsFiles, rootDir, toolingConfig, log);
  if (configPath) {
    const relative = path.isAbsolute(configPath) ? path.relative(rootDir, configPath) : configPath;
    log(`[index] TypeScript tooling using ${relative || configPath}`);
  } else if (toolingConfig?.typescript?.useTsconfig !== false) {
    log('[index] TypeScript tooling using default compiler options (tsconfig not found).');
  }

  const typesByChunk = new Map();
  const tsTypesByFile = buildTypeScriptMap(ts, program, uniqueTsFiles);
  for (const [file, chunks] of chunksByFile.entries()) {
    const ext = path.extname(file).toLowerCase();
    if (!['.ts', '.tsx', '.mts', '.cts'].includes(ext)) continue;
    const absFile = path.resolve(rootDir, file);
    const fileMap = tsTypesByFile.get(absFile);
    if (!fileMap) continue;
    for (const chunk of chunks) {
      const tsEntry = fileMap[chunk.name];
      if (!tsEntry) continue;
      const key = `${chunk.file}::${chunk.name}`;
      const entry = typesByChunk.get(key) || createToolingEntry();
      if (tsEntry.returnType) {
        entry.returns = uniqueTypes([...(entry.returns || []), tsEntry.returnType]);
      }
      if (tsEntry.paramTypes && typeof tsEntry.paramTypes === 'object') {
        for (const [name, type] of Object.entries(tsEntry.paramTypes)) {
          if (!name || !type) continue;
          const existing = entry.params?.[name] || [];
          entry.params[name] = uniqueTypes([...(existing || []), type]);
        }
      }
      typesByChunk.set(key, entry);
    }
  }
  log(`[index] TypeScript tooling enabled for ${uniqueTsFiles.length} file(s).`);
  return { typesByChunk, fileCount: uniqueTsFiles.length };
}
