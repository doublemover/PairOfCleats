import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getToolingConfig } from '../../tools/dict-utils.js';

const FLOW_SOURCE = 'flow';
const TOOLING_SOURCE = 'tooling';
const FLOW_CONFIDENCE = 0.55;
const TOOLING_CONFIDENCE = 0.85;

const TYPE_KIND_PATTERNS = [
  /class/i,
  /struct/i,
  /enum/i,
  /interface/i,
  /protocol/i,
  /trait/i,
  /record/i,
  /type/i
];

const RETURN_CALL_RX = /return\s+(?:await\s+)?(?!new\s)([A-Za-z_$][\w$.:]*)\s*\(/g;
const RETURN_NEW_RX = /return\s+(?:await\s+)?new\s+([A-Za-z_$][\w$.:]*)\s*\(/g;

const normalizeName = (value) => String(value || '').trim();

const leafName = (value) => {
  if (!value) return null;
  const parts = String(value).split(/::|\./).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
};

const isTypeDeclaration = (kind) => {
  if (!kind) return false;
  return TYPE_KIND_PATTERNS.some((rx) => rx.test(kind));
};

const addSymbol = (index, key, entry) => {
  if (!key) return;
  const list = index.get(key) || [];
  list.push(entry);
  index.set(key, list);
};

const addLink = (list, link) => {
  if (!link) return;
  const key = `${link.name}:${link.target}:${link.file}`;
  if (list._keys?.has(key)) return;
  if (!list._keys) list._keys = new Set();
  list._keys.add(key);
  list.push(link);
};

const uniqueTypes = (values) => Array.from(new Set(values.filter(Boolean)));

const extractReturnTypes = (chunk) => {
  const docmeta = chunk?.docmeta || {};
  const types = [];
  if (docmeta.returnType) types.push(docmeta.returnType);
  if (Array.isArray(docmeta.inferredTypes?.returns)) {
    for (const entry of docmeta.inferredTypes.returns) {
      if (entry?.type) types.push(entry.type);
    }
  }
  if (isTypeDeclaration(chunk?.kind) && chunk?.name) {
    types.push(chunk.name);
  }
  return uniqueTypes(types);
};

const resolveUniqueSymbol = (index, name) => {
  if (!name) return null;
  const direct = index.get(name) || [];
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;
  const leaf = leafName(name);
  if (!leaf || leaf === name) return null;
  const leafMatches = index.get(leaf) || [];
  return leafMatches.length === 1 ? leafMatches[0] : null;
};

const ensureInferred = (docmeta) => {
  if (!docmeta.inferredTypes || typeof docmeta.inferredTypes !== 'object') {
    docmeta.inferredTypes = {};
  }
  return docmeta.inferredTypes;
};

const addInferredReturn = (docmeta, type, source, confidence) => {
  if (!type) return false;
  const inferred = ensureInferred(docmeta);
  if (!Array.isArray(inferred.returns)) inferred.returns = [];
  const existing = inferred.returns.find((entry) => entry.type === type && entry.source === source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence || 0, confidence);
    return true;
  }
  inferred.returns.push({ type, source, confidence });
  return true;
};

const addInferredParam = (docmeta, name, type, source, confidence) => {
  if (!name || !type) return false;
  const inferred = ensureInferred(docmeta);
  if (!inferred.params || typeof inferred.params !== 'object') inferred.params = {};
  const list = inferred.params[name] || [];
  const existing = list.find((entry) => entry.type === type && entry.source === source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence || 0, confidence);
    inferred.params[name] = list;
    return true;
  }
  inferred.params[name] = [...list, { type, source, confidence }];
  return true;
};

const extractReturnCalls = (chunkText) => {
  const calls = new Set();
  const news = new Set();
  if (!chunkText) return { calls, news };
  RETURN_CALL_RX.lastIndex = 0;
  RETURN_NEW_RX.lastIndex = 0;
  let match;
  while ((match = RETURN_CALL_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) calls.add(name);
  }
  while ((match = RETURN_NEW_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) news.add(name);
  }
  return { calls, news };
};

async function loadTypeScript(toolingConfig, repoRoot) {
  const toolingRoot = toolingConfig?.dir || '';
  const candidates = [
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
    toolingRoot ? path.join(toolingRoot, 'node', 'node_modules', 'typescript', 'lib', 'typescript.js') : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!fsSync.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      return mod?.default || mod;
    } catch {}
  }
  try {
    const mod = await import('typescript');
    return mod?.default || mod;
  } catch {
    return null;
  }
}

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
    const visit = (node, contextName = null) => {
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
      ts.forEachChild(node, (child) => visit(child, contextName));
    };
    visit(sourceFile);
  }
  return byFile;
};

export async function applyCrossFileInference({
  rootDir,
  chunks,
  enabled,
  log = () => {},
  useTooling = false
}) {
  if (!enabled) return { linkedCalls: 0, linkedUsages: 0, inferredReturns: 0 };
  const symbolIndex = new Map();
  const symbolEntries = [];
  const entryByKey = new Map();

  for (const chunk of chunks) {
    if (!chunk?.name) continue;
    const entry = {
      name: chunk.name,
      file: chunk.file,
      kind: chunk.kind || null,
      returnTypes: extractReturnTypes(chunk),
      typeDeclaration: isTypeDeclaration(chunk.kind)
    };
    symbolEntries.push(entry);
    entryByKey.set(`${chunk.file}::${chunk.name}`, entry);
    addSymbol(symbolIndex, chunk.name, entry);
    const leaf = leafName(chunk.name);
    if (leaf && leaf !== chunk.name) addSymbol(symbolIndex, leaf, entry);
  }

  let tsTypesByFile = null;
  if (useTooling) {
    const tsFiles = symbolEntries
      .map((entry) => entry.file)
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.mts') || file.endsWith('.cts'))
      .map((file) => path.resolve(rootDir, file));
    const uniqueTsFiles = Array.from(new Set(tsFiles));
    if (uniqueTsFiles.length) {
      const toolingConfig = getToolingConfig(rootDir);
      const ts = await loadTypeScript(toolingConfig, rootDir);
      if (ts) {
        tsTypesByFile = buildTypeScriptMap(ts, uniqueTsFiles);
        log(`[index] TypeScript tooling enabled for ${uniqueTsFiles.length} file(s).`);
      } else {
        log('[index] TypeScript tooling not detected; skipping tooling-based types.');
      }
    }
  }

  const textCache = new Map();
  const getChunkText = async (chunk) => {
    if (!chunk?.file) return '';
    const absPath = path.join(rootDir, chunk.file);
    if (!textCache.has(absPath)) {
      try {
        textCache.set(absPath, await fs.readFile(absPath, 'utf8'));
      } catch {
        textCache.set(absPath, '');
      }
    }
    const text = textCache.get(absPath) || '';
    return text.slice(chunk.start, chunk.end);
  };

  let linkedCalls = 0;
  let linkedUsages = 0;
  let inferredReturns = 0;

  for (const chunk of chunks) {
    if (!chunk) continue;
    if (chunk.docmeta && chunk.docmeta.returnsValue) {
      const chunkText = await getChunkText(chunk);
      const { news: returnNews } = extractReturnCalls(chunkText);
      for (const typeName of returnNews) {
        if (addInferredReturn(chunk.docmeta, typeName, FLOW_SOURCE, FLOW_CONFIDENCE)) {
          inferredReturns += 1;
        }
        const entry = entryByKey.get(`${chunk.file}::${chunk.name}`);
        if (entry) {
          entry.returnTypes = uniqueTypes([...(entry.returnTypes || []), typeName]);
        }
      }
    }
  }

  for (const chunk of chunks) {
    if (!chunk) continue;
    const relations = chunk.codeRelations || {};
    const callLinks = [];
    const usageLinks = [];

    if (Array.isArray(relations.calls)) {
      for (const [, callee] of relations.calls) {
        const resolved = resolveUniqueSymbol(symbolIndex, callee);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        addLink(callLinks, {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        });
      }
    }

    if (Array.isArray(relations.usages)) {
      for (const usage of relations.usages) {
        const resolved = resolveUniqueSymbol(symbolIndex, usage);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        addLink(usageLinks, {
          name: usage,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        });
      }
    }

    if (callLinks.length) {
      relations.callLinks = callLinks;
      linkedCalls += callLinks.length;
    }
    if (usageLinks.length) {
      relations.usageLinks = usageLinks;
      linkedUsages += usageLinks.length;
    }
    chunk.codeRelations = relations;

    if (chunk.docmeta && chunk.docmeta.returnsValue) {
      const chunkText = await getChunkText(chunk);
      const { calls: returnCalls } = extractReturnCalls(chunkText);
      for (const callName of returnCalls) {
        const resolved = resolveUniqueSymbol(symbolIndex, callName);
        if (!resolved || !resolved.returnTypes?.length) continue;
        for (const type of resolved.returnTypes) {
          if (addInferredReturn(chunk.docmeta, type, FLOW_SOURCE, FLOW_CONFIDENCE)) {
            inferredReturns += 1;
          }
        }
      }
    }

    if (tsTypesByFile && chunk.docmeta && chunk.file) {
      const absFile = path.resolve(rootDir, chunk.file);
      const tsMap = tsTypesByFile.get(absFile);
      if (tsMap && tsMap[chunk.name]) {
        const tsEntry = tsMap[chunk.name];
        if (tsEntry.returnType) {
          if (addInferredReturn(chunk.docmeta, tsEntry.returnType, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
            inferredReturns += 1;
          }
        }
        const params = tsEntry.paramTypes || {};
        for (const [name, type] of Object.entries(params)) {
          if (addInferredParam(chunk.docmeta, name, type, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
            // no-op, keep count minimal
          }
        }
      }
    }
  }

  return { linkedCalls, linkedUsages, inferredReturns };
}
