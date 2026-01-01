import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createToolingEntry, uniqueTypes } from './shared.js';

const buildTypeScriptMap = (ts, filePaths) => {
  const program = ts.createProgram(filePaths, {
    allowJs: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.Preserve
  });
  const checker = program.getTypeChecker();
  const byFile = new Map();
  const record = (fileName, name, signature, params) => {
    if (!fileName || !name || !signature) return;
    const returnType = checker.typeToString(checker.getReturnTypeOfSignature(signature));
    const paramTypes = {};
    for (const param of params || []) {
      if (!param?.name) continue;
      const paramType = checker.typeToString(checker.getTypeAtLocation(param));
      if (paramType) paramTypes[param.name] = paramType;
    }
    const fileMap = byFile.get(fileName) || {};
    fileMap[name] = { returnType, paramTypes };
    byFile.set(fileName, fileMap);
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (!filePaths.includes(sourceFile.fileName)) continue;
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.getText(sourceFile);
        node.members?.forEach((member) => {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText(sourceFile);
            const signature = checker.getSignatureFromDeclaration(member);
            if (signature) {
              record(sourceFile.fileName, `${className}.${methodName}`, signature, member.parameters);
            }
          }
        });
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        const signature = checker.getSignatureFromDeclaration(node);
        if (signature) {
          record(sourceFile.fileName, node.name.getText(sourceFile), signature, node.parameters);
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

  const typesByChunk = new Map();
  const tsTypesByFile = buildTypeScriptMap(ts, uniqueTsFiles);
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
