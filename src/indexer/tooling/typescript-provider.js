import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createToolingEntry, uniqueTypes } from '../../tooling/providers/shared.js';

const DEFAULT_CONFIG_FILES = ['tsconfig.json'];

const normalizePathKey = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const createDefaultCompilerOptions = (ts) => ({
  allowJs: true,
  checkJs: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve
});

const formatDiagnostic = (ts, diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic?.messageText || '', '\n');
  if (diagnostic?.file?.fileName) return `${diagnostic.file.fileName}: ${message}`;
  return message;
};

const isWithinRoot = (rootDir, candidate) => {
  const root = normalizePathKey(rootDir);
  const resolved = normalizePathKey(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
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

const resolveTsconfigOverride = (rootDir, toolingConfig, log) => {
  const override = toolingConfig?.typescript?.tsconfigPath;
  if (!override) return null;
  const resolved = path.isAbsolute(override) ? override : path.join(rootDir, override);
  if (fsSync.existsSync(resolved)) return resolved;
  log(`[index] TypeScript tsconfig not found at ${resolved}; falling back.`);
  return null;
};

const resolveNearestTsconfig = (filePath, rootDir, cache) => {
  const startDir = path.dirname(filePath);
  const root = path.resolve(rootDir);
  let dir = startDir;
  const visited = [];
  while (true) {
    const key = normalizePathKey(dir);
    if (cache.has(key)) {
      const cached = cache.get(key);
      for (const entry of visited) {
        cache.set(entry, cached);
      }
      return cached;
    }
    visited.push(key);
    for (const candidateName of DEFAULT_CONFIG_FILES) {
      const candidate = path.join(dir, candidateName);
      if (fsSync.existsSync(candidate)) {
        for (const entry of visited) {
          cache.set(entry, candidate);
        }
        return candidate;
      }
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    if (!isWithinRoot(rootDir, parent)) break;
    dir = parent;
  }
  for (const entry of visited) {
    cache.set(entry, null);
  }
  return null;
};

const resolveTsconfigForFile = (filePath, rootDir, toolingConfig, cache, log) => {
  if (toolingConfig?.typescript?.useTsconfig === false) return null;
  const override = resolveTsconfigOverride(rootDir, toolingConfig, log);
  if (override) return override;
  return resolveNearestTsconfig(filePath, rootDir, cache);
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

const getIdentifierName = (ts, node) => {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return null;
};

const isFunctionInitializer = (ts, node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

const buildTypeScriptMap = (ts, program, targetFiles) => {
  const targetSet = new Set(targetFiles.map(normalizePathKey));
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
      if (paramType) paramTypes[paramName] = uniqueTypes([...(paramTypes[paramName] || []), paramType]);
    }
    const fileMap = byFile.get(fileName) || {};
    if (!fileMap[name]) {
      fileMap[name] = { returnType, paramTypes };
    } else {
      const existing = fileMap[name];
      if (returnType && (!existing.returnType || existing.returnType !== returnType)) {
        existing.returnType = existing.returnType
          ? uniqueTypes([existing.returnType, returnType]).join(' | ')
          : returnType;
      }
      for (const [paramName, paramList] of Object.entries(paramTypes)) {
        const existingList = existing.paramTypes?.[paramName] || [];
        existing.paramTypes = existing.paramTypes || {};
        existing.paramTypes[paramName] = uniqueTypes([...(existingList || []), ...paramList]);
      }
    }
    byFile.set(fileName, fileMap);
  };

  const recordFunctionLike = (fileName, name, node) => {
    const signature = checker.getSignatureFromDeclaration(node);
    if (signature) record(fileName, name, signature, node.parameters);
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (!targetSet.has(normalizePathKey(sourceFile.fileName))) continue;
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.getText(sourceFile);
        node.members?.forEach((member) => {
          if (ts.isConstructorDeclaration(member)) {
            recordFunctionLike(sourceFile.fileName, `${className}.constructor`, member);
            return;
          }
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = getIdentifierName(ts, member.name);
            if (methodName) recordFunctionLike(sourceFile.fileName, `${className}.${methodName}`, member);
            return;
          }
          if ((ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.name) {
            const accessorName = getIdentifierName(ts, member.name);
            if (accessorName) recordFunctionLike(sourceFile.fileName, `${className}.${accessorName}`, member);
            return;
          }
          if (ts.isPropertyDeclaration(member) && member.name && member.initializer) {
            const propName = getIdentifierName(ts, member.name);
            if (propName && isFunctionInitializer(ts, member.initializer)) {
              recordFunctionLike(sourceFile.fileName, `${className}.${propName}`, member.initializer);
            }
          }
        });
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        recordFunctionLike(sourceFile.fileName, node.name.getText(sourceFile), node);
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isFunctionInitializer(ts, node.initializer)) {
          recordFunctionLike(sourceFile.fileName, node.name.text, node.initializer);
        }
      }

      ts.forEachChild(node, (child) => visit(child));
    };
    visit(sourceFile);
  }
  return byFile;
};

const createProgramFromConfig = (ts, configPath, filePaths, log) => {
  const defaultOptions = createDefaultCompilerOptions(ts);
  const parsed = parseTsConfig(ts, configPath, log);
  if (!parsed) {
    return { program: ts.createProgram({ rootNames: filePaths, options: defaultOptions }), configPath: null };
  }

  const rootNames = uniqueTypes([...(parsed.fileNames || []), ...filePaths]);
  const options = { ...defaultOptions, ...parsed.options };
  const program = ts.createProgram({
    rootNames,
    options,
    projectReferences: parsed.projectReferences
  });
  return { program, configPath };
};

const createProgramDefault = (ts, filePaths) => {
  const options = createDefaultCompilerOptions(ts);
  return { program: ts.createProgram({ rootNames: filePaths, options }), configPath: null };
};

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

  const configCache = new Map();
  const groups = new Map();
  for (const filePath of uniqueTsFiles) {
    const configPath = resolveTsconfigForFile(filePath, rootDir, toolingConfig, configCache, log);
    const key = configPath || '__default__';
    if (!groups.has(key)) {
      groups.set(key, { configPath, files: new Set() });
    }
    groups.get(key).files.add(filePath);
  }

  const typesByChunk = new Map();
  for (const group of groups.values()) {
    const filePaths = Array.from(group.files);
    if (!filePaths.length) continue;
    let programResult = null;
    if (group.configPath) {
      programResult = createProgramFromConfig(ts, group.configPath, filePaths, log);
      log(`[index] TypeScript tooling using ${group.configPath} (${filePaths.length} file(s)).`);
    } else {
      programResult = createProgramDefault(ts, filePaths);
      if (toolingConfig?.typescript?.useTsconfig !== false) {
        log(`[index] TypeScript tooling using default compiler options (${filePaths.length} file(s)).`);
      }
    }

    const tsTypesByFile = buildTypeScriptMap(ts, programResult.program, filePaths);
    for (const [file, chunks] of chunksByFile.entries()) {
      const ext = path.extname(file).toLowerCase();
      if (!['.ts', '.tsx', '.mts', '.cts'].includes(ext)) continue;
      const absFile = path.resolve(rootDir, file);
      if (!group.files.has(absFile)) continue;
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
          for (const [name, types] of Object.entries(tsEntry.paramTypes)) {
            if (!name || !Array.isArray(types)) continue;
            const existing = entry.params?.[name] || [];
            entry.params[name] = uniqueTypes([...(existing || []), ...types]);
          }
        }
        typesByChunk.set(key, entry);
      }
    }
  }

  log(`[index] TypeScript tooling enabled for ${uniqueTsFiles.length} file(s).`);
  return { typesByChunk, fileCount: uniqueTsFiles.length };
}
