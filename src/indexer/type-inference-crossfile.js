import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getToolingConfig } from '../../tools/dict-utils.js';
import { buildLineIndex } from '../shared/lines.js';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../tooling/lsp/client.js';
import { rangeToOffsets } from '../tooling/lsp/positions.js';
import { flattenSymbols } from '../tooling/lsp/symbols.js';

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
  if (Array.isArray(docmeta.returns)) {
    for (const value of docmeta.returns) {
      if (value) types.push(value);
    }
  } else if (docmeta.returns) {
    types.push(docmeta.returns);
  }
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

const extractParamTypes = (chunk) => {
  const docmeta = chunk?.docmeta || {};
  const paramNames = Array.isArray(docmeta.params) ? docmeta.params : [];
  const paramTypes = {};

  if (docmeta.paramTypes && typeof docmeta.paramTypes === 'object') {
    for (const [name, type] of Object.entries(docmeta.paramTypes)) {
      if (!name || !type) continue;
      paramTypes[name] = uniqueTypes([...(paramTypes[name] || []), type]);
    }
  }

  const inferred = docmeta.inferredTypes?.params || {};
  if (inferred && typeof inferred === 'object') {
    for (const [name, entries] of Object.entries(inferred)) {
      if (!name || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry?.type) continue;
        paramTypes[name] = uniqueTypes([...(paramTypes[name] || []), entry.type]);
      }
    }
  }

  return { paramNames, paramTypes };
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

const splitParams = (value) => {
  if (!value) return [];
  const params = [];
  let current = '';
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (const ch of value) {
    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === '(') depthParen += 1;
    if (ch === ')' && depthParen > 0) depthParen -= 1;
    if (ch === '[') depthBracket += 1;
    if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    if (ch === '{') depthBrace += 1;
    if (ch === '}' && depthBrace > 0) depthBrace -= 1;
    if (ch === ',' && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params;
};

const normalizeHoverContents = (contents) => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((entry) => normalizeHoverContents(entry)).filter(Boolean).join('\n');
  }
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value;
    if (typeof contents.language === 'string' && typeof contents.value === 'string') return contents.value;
  }
  return '';
};

const extractSwiftSignature = (detail) => {
  const open = detail.indexOf('(');
  const close = detail.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = detail.trim();
  const paramsText = detail.slice(open + 1, close).trim();
  const after = detail.slice(close + 1).trim();
  const arrowMatch = after.match(/->\s*(.+)$/);
  const returnType = arrowMatch ? arrowMatch[1].trim() : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const cleaned = part.replace(/=.*/g, '').trim();
    if (!cleaned) continue;
    const segments = cleaned.split(':');
    if (segments.length < 2) continue;
    const nameTokens = segments[0].trim().split(/\s+/).filter(Boolean);
    let name = nameTokens[nameTokens.length - 1] || '';
    if (name === '_' && nameTokens.length > 1) {
      name = nameTokens[nameTokens.length - 2] || '';
    }
    const type = segments.slice(1).join(':').trim();
    if (!name || !type) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  return { signature, returnType, paramTypes, paramNames };
};

const extractObjcSignature = (detail) => {
  if (!detail.includes(':')) return null;
  const signature = detail.trim();
  const returnMatch = signature.match(/\(([^)]+)\)\s*[^:]+/);
  const returnType = returnMatch ? returnMatch[1].trim() : null;
  const paramTypes = {};
  const paramNames = [];
  const paramRe = /:\s*\(([^)]+)\)\s*([A-Za-z_][\w]*)/g;
  let match;
  while ((match = paramRe.exec(signature)) !== null) {
    const type = match[1]?.trim();
    const name = match[2]?.trim();
    if (!type || !name) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

const extractClikeSignature = (detail, symbolName) => {
  const open = detail.indexOf('(');
  const close = detail.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = detail.trim();
  const before = detail.slice(0, open).trim();
  const paramsText = detail.slice(open + 1, close).trim();
  let returnType = null;
  if (before) {
    let idx = -1;
    if (symbolName) {
      idx = before.lastIndexOf(symbolName);
      if (idx === -1) idx = before.lastIndexOf(`::${symbolName}`);
      if (idx !== -1 && before[idx] === ':' && before[idx - 1] === ':') idx -= 1;
    }
    returnType = idx > 0 ? before.slice(0, idx).trim() : before;
    returnType = returnType.replace(/\b(static|inline|constexpr|virtual|extern|friend)\b/g, '').trim();
  }
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const cleaned = part.trim();
    if (!cleaned || cleaned === 'void' || cleaned === '...') continue;
    const noDefault = cleaned.split('=').shift().trim();
    const nameMatch = noDefault.match(/([A-Za-z_][\w]*)\s*(?:\[[^\]]*\])?$/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const type = noDefault.slice(0, nameMatch.index).trim();
    if (!name || !type) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  return { signature, returnType, paramTypes, paramNames };
};

const extractSignatureInfo = (detail, languageId, symbolName) => {
  if (!detail || typeof detail !== 'string') return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  if (languageId === 'swift') return extractSwiftSignature(trimmed);
  if (languageId === 'objective-c' || languageId === 'objective-cpp') {
    const objc = extractObjcSignature(trimmed);
    if (objc) return objc;
  }
  if (languageId === 'c' || languageId === 'cpp' || languageId === 'objective-c' || languageId === 'objective-cpp') {
    return extractClikeSignature(trimmed, symbolName);
  }
  return null;
};

const findChunkForOffsets = (chunks, start, end) => {
  let best = null;
  let bestSpan = Infinity;
  for (const chunk of chunks || []) {
    if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) continue;
    if (start >= chunk.start && end <= chunk.end) {
      const span = chunk.end - chunk.start;
      if (span < bestSpan) {
        best = chunk;
        bestSpan = span;
      }
    }
  }
  return best;
};

const resolveCompileCommandsDir = (rootDir, clangdConfig) => {
  const candidates = [];
  if (clangdConfig?.compileCommandsDir) {
    const value = clangdConfig.compileCommandsDir;
    candidates.push(path.isAbsolute(value) ? value : path.join(rootDir, value));
  } else {
    candidates.push(rootDir);
    candidates.push(path.join(rootDir, 'build'));
    candidates.push(path.join(rootDir, 'out'));
    candidates.push(path.join(rootDir, 'cmake-build-debug'));
    candidates.push(path.join(rootDir, 'cmake-build-release'));
  }
  for (const dir of candidates) {
    const candidate = path.join(dir, 'compile_commands.json');
    if (fsSync.existsSync(candidate)) return dir;
  }
  return null;
};

const buildChunksByFile = (chunks) => {
  const byFile = new Map();
  for (const chunk of chunks || []) {
    if (!chunk?.file) continue;
    const list = byFile.get(chunk.file) || [];
    list.push(chunk);
    byFile.set(chunk.file, list);
  }
  return byFile;
};

const filterChunksByExt = (chunksByFile, extensions) => {
  const extSet = new Set(extensions.map((ext) => ext.toLowerCase()));
  const filtered = new Map();
  for (const [file, chunks] of chunksByFile.entries()) {
    const ext = path.extname(file).toLowerCase();
    if (!extSet.has(ext)) continue;
    filtered.set(file, chunks);
  }
  return filtered;
};

const applyLspTypes = async ({
  rootDir,
  chunksByFile,
  entryByKey,
  log,
  cmd,
  args,
  timeoutMs = 15000
}) => {
  const files = Array.from(chunksByFile.keys());
  if (!files.length) return { inferredReturns: 0, enriched: 0 };

  const client = createLspClient({ cmd, args, cwd: rootDir, log });
  const rootUri = pathToFileUri(rootDir);
  try {
    await client.initialize({
      rootUri,
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } }
    });
  } catch (err) {
    log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
    client.kill();
    return { inferredReturns: 0, enriched: 0 };
  }

  let inferredReturns = 0;
  let enriched = 0;
  for (const file of files) {
    const absPath = path.join(rootDir, file);
    let text = '';
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    const uri = pathToFileUri(absPath);
    const languageId = languageIdForFileExt(path.extname(file));
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text
      }
    });

    let symbols = null;
    try {
      symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs });
    } catch (err) {
      log(`[index] ${cmd} documentSymbol failed (${file}): ${err?.message || err}`);
      client.notify('textDocument/didClose', { textDocument: { uri } });
      continue;
    }
    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      client.notify('textDocument/didClose', { textDocument: { uri } });
      continue;
    }

    const lineIndex = buildLineIndex(text);
    const fileChunks = chunksByFile.get(file) || [];

    for (const symbol of flattened) {
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
      const target = findChunkForOffsets(fileChunks, offsets.start, offsets.end);
      if (!target) continue;
      const entry = entryByKey.get(`${target.file}::${target.name}`);
      let info = extractSignatureInfo(symbol.detail, languageId, symbol.name);
      if (!info || (!info.returnType && !Object.keys(info.paramTypes || {}).length)) {
        try {
          const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: symbol.selectionRange?.start || symbol.range?.start
          }, { timeoutMs: 8000 });
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = extractSignatureInfo(hoverText, languageId, symbol.name);
          if (hoverInfo) info = hoverInfo;
        } catch {}
      }
      if (!info) continue;

      if (!target.docmeta || typeof target.docmeta !== 'object') target.docmeta = {};
      if (info.signature && !target.docmeta.signature) target.docmeta.signature = info.signature;
      if (info.paramNames?.length && (!Array.isArray(target.docmeta.params) || !target.docmeta.params.length)) {
        target.docmeta.params = info.paramNames.slice();
      }
      if (info.returnType) {
        if (!target.docmeta.returnType) target.docmeta.returnType = info.returnType;
        if (addInferredReturn(target.docmeta, info.returnType, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
          inferredReturns += 1;
        }
        if (entry) {
          entry.returnTypes = uniqueTypes([...(entry.returnTypes || []), info.returnType]);
        }
      }
      if (info.paramTypes && Object.keys(info.paramTypes).length) {
        if (!target.docmeta.paramTypes || typeof target.docmeta.paramTypes !== 'object') {
          target.docmeta.paramTypes = {};
        }
        for (const [name, type] of Object.entries(info.paramTypes)) {
          if (!name || !type) continue;
          if (!target.docmeta.paramTypes[name]) target.docmeta.paramTypes[name] = type;
          addInferredParam(target.docmeta, name, type, TOOLING_SOURCE, TOOLING_CONFIDENCE);
          if (entry) {
            const existing = entry.paramTypes?.[name] || [];
            entry.paramTypes = entry.paramTypes || {};
            entry.paramTypes[name] = uniqueTypes([...(existing || []), type]);
          }
        }
      }
      enriched += 1;
    }

    client.notify('textDocument/didClose', { textDocument: { uri } });
  }

  await client.shutdownAndExit();
  client.kill();
  return { inferredReturns, enriched };
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
  useTooling = false,
  enableTypeInference = true,
  enableRiskCorrelation = false
}) {
  if (!enabled) {
    return { linkedCalls: 0, linkedUsages: 0, inferredReturns: 0, riskFlows: 0 };
  }
  const toolingConfig = useTooling ? getToolingConfig(rootDir) : null;
  const symbolIndex = new Map();
  const symbolEntries = [];
  const entryByKey = new Map();
  const chunkByKey = new Map();
  const riskSeverityRank = { low: 1, medium: 2, high: 3 };

  for (const chunk of chunks) {
    if (!chunk?.name) continue;
    chunkByKey.set(`${chunk.file}::${chunk.name}`, chunk);
    const { paramNames, paramTypes } = extractParamTypes(chunk);
    const entry = {
      name: chunk.name,
      file: chunk.file,
      kind: chunk.kind || null,
      returnTypes: extractReturnTypes(chunk),
      typeDeclaration: isTypeDeclaration(chunk.kind),
      paramNames,
      paramTypes
    };
    symbolEntries.push(entry);
    entryByKey.set(`${chunk.file}::${chunk.name}`, entry);
    addSymbol(symbolIndex, chunk.name, entry);
    const leaf = leafName(chunk.name);
    if (leaf && leaf !== chunk.name) addSymbol(symbolIndex, leaf, entry);
  }

  const chunksByFile = buildChunksByFile(chunks);
  let tsTypesByFile = null;
  if (useTooling && enableTypeInference) {
    const tsFiles = symbolEntries
      .map((entry) => entry.file)
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.mts') || file.endsWith('.cts'))
      .map((file) => path.resolve(rootDir, file));
    const uniqueTsFiles = Array.from(new Set(tsFiles));
    if (uniqueTsFiles.length) {
      const ts = await loadTypeScript(toolingConfig, rootDir);
      if (ts) {
        tsTypesByFile = buildTypeScriptMap(ts, uniqueTsFiles);
        log(`[index] TypeScript tooling enabled for ${uniqueTsFiles.length} file(s).`);
      } else {
        log('[index] TypeScript tooling not detected; skipping tooling-based types.');
      }
    }
  }

  let linkedCalls = 0;
  let linkedUsages = 0;
  let inferredReturns = 0;
  let riskFlows = 0;

  if (useTooling && enableTypeInference && toolingConfig?.autoEnableOnDetect !== false) {
    const clangdFiles = filterChunksByExt(chunksByFile, [
      '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm'
    ]);
    if (clangdFiles.size) {
      const clangdConfig = toolingConfig?.clangd || {};
      const compileCommandsDir = resolveCompileCommandsDir(rootDir, clangdConfig);
      const requireCompilationDatabase = clangdConfig.requireCompilationDatabase === true;
      if (!compileCommandsDir && requireCompilationDatabase) {
        log('[index] clangd requires compile_commands.json; skipping tooling-based types.');
      } else {
        const clangdArgs = [];
        if (compileCommandsDir) clangdArgs.push(`--compile-commands-dir=${compileCommandsDir}`);
        if (!compileCommandsDir) {
          log('[index] clangd running in best-effort mode (compile_commands.json not found).');
        }
        const clangdResult = await applyLspTypes({
          rootDir,
          chunksByFile: clangdFiles,
          entryByKey,
          log,
          cmd: 'clangd',
          args: clangdArgs
        });
        inferredReturns += clangdResult.inferredReturns || 0;
        if (clangdResult.enriched) {
          log(`[index] clangd enriched ${clangdResult.enriched} symbol(s).`);
        }
      }
    }

    const swiftFiles = filterChunksByExt(chunksByFile, ['.swift']);
    if (swiftFiles.size) {
      const swiftResult = await applyLspTypes({
        rootDir,
        chunksByFile: swiftFiles,
        entryByKey,
        log,
        cmd: 'sourcekit-lsp',
        args: []
      });
      inferredReturns += swiftResult.inferredReturns || 0;
      if (swiftResult.enriched) {
        log(`[index] sourcekit-lsp enriched ${swiftResult.enriched} symbol(s).`);
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

  if (enableTypeInference) {
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
  }

  const normalizeRisk = (chunk) => {
    if (!chunk) return null;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    const base = chunk.docmeta.risk && typeof chunk.docmeta.risk === 'object'
      ? chunk.docmeta.risk
      : {};
    const risk = {
      ...base,
      tags: Array.isArray(base.tags) ? base.tags.slice() : [],
      categories: Array.isArray(base.categories) ? base.categories.slice() : [],
      sources: Array.isArray(base.sources) ? base.sources.slice() : [],
      sinks: Array.isArray(base.sinks) ? base.sinks.slice() : [],
      flows: Array.isArray(base.flows) ? base.flows.slice() : []
    };
    chunk.docmeta.risk = risk;
    return risk;
  };

  const addUnique = (list, value) => {
    if (!value) return;
    if (!list.includes(value)) list.push(value);
  };

  const riskFlowKeys = new WeakMap();
  const flowKey = (flow) => `${flow.source}::${flow.sink}::${flow.scope || 'local'}::${flow.via || ''}`;
  const getFlowKeys = (chunk, risk) => {
    if (!chunk || !risk) return null;
    let keys = riskFlowKeys.get(chunk);
    if (!keys) {
      keys = new Set();
      if (Array.isArray(risk.flows)) {
        for (const existing of risk.flows) {
          if (!existing) continue;
          keys.add(flowKey(existing));
        }
      }
      riskFlowKeys.set(chunk, keys);
    }
    return keys;
  };
  const addRiskFlow = (chunk, risk, flow) => {
    if (!risk || !flow) return false;
    const keys = getFlowKeys(chunk, risk);
    if (!keys) return false;
    const key = flowKey(flow);
    if (keys.has(key)) return false;
    keys.add(key);
    risk.flows.push(flow);
    return true;
  };

  for (const chunk of chunks) {
    if (!chunk) continue;
    const relations = chunk.codeRelations || {};
    const callLinks = [];
    const callSummaries = [];
    const usageLinks = [];

    if (Array.isArray(relations.calls)) {
      for (const [, callee] of relations.calls) {
        const resolved = resolveUniqueSymbol(symbolIndex, callee);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        const link = {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        };
        if (resolved.returnTypes?.length) link.returnTypes = resolved.returnTypes;
        if (resolved.paramNames?.length) link.paramNames = resolved.paramNames;
        if (resolved.paramTypes && Object.keys(resolved.paramTypes).length) link.paramTypes = resolved.paramTypes;
        addLink(callLinks, link);
      }
    }

    if (Array.isArray(relations.callDetails)) {
      for (const detail of relations.callDetails) {
        const callee = detail?.callee;
        if (!callee) continue;
        const resolved = resolveUniqueSymbol(symbolIndex, callee);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        const args = Array.isArray(detail.args) ? detail.args : [];
        const summary = {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind,
          args
        };
        if (resolved.returnTypes?.length) summary.returnTypes = resolved.returnTypes;
        if (resolved.paramNames?.length) summary.params = resolved.paramNames;
        if (resolved.paramTypes && Object.keys(resolved.paramTypes).length) summary.paramTypes = resolved.paramTypes;
        if (args.length && resolved.paramNames?.length) {
          const argMap = {};
          for (let i = 0; i < resolved.paramNames.length && i < args.length; i += 1) {
            const paramName = resolved.paramNames[i];
            const argValue = args[i];
            if (paramName && argValue) argMap[paramName] = argValue;
          }
          if (Object.keys(argMap).length) summary.argMap = argMap;
        }
        addLink(callSummaries, summary);
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
    if (callSummaries.length) {
      relations.callSummaries = callSummaries;
    }
    if (usageLinks.length) {
      relations.usageLinks = usageLinks;
      linkedUsages += usageLinks.length;
    }
    chunk.codeRelations = relations;

    if (enableTypeInference && chunk.docmeta && chunk.docmeta.returnsValue) {
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

    if (tsTypesByFile && enableTypeInference && chunk.docmeta && chunk.file) {
      const absFile = path.resolve(rootDir, chunk.file);
      const tsMap = tsTypesByFile.get(absFile);
      if (tsMap && tsMap[chunk.name]) {
        const tsEntry = tsMap[chunk.name];
        if (tsEntry.returnType) {
          if (!chunk.docmeta.returnType) chunk.docmeta.returnType = tsEntry.returnType;
          if (addInferredReturn(chunk.docmeta, tsEntry.returnType, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
            inferredReturns += 1;
          }
          const entry = entryByKey.get(`${chunk.file}::${chunk.name}`);
          if (entry) {
            entry.returnTypes = uniqueTypes([...(entry.returnTypes || []), tsEntry.returnType]);
          }
        }
        const params = tsEntry.paramTypes || {};
        if (Object.keys(params).length) {
          if (!chunk.docmeta.paramTypes || typeof chunk.docmeta.paramTypes !== 'object') {
            chunk.docmeta.paramTypes = {};
          }
          for (const [name, type] of Object.entries(params)) {
            if (!name || !type) continue;
            if (!chunk.docmeta.paramTypes[name]) chunk.docmeta.paramTypes[name] = type;
            addInferredParam(chunk.docmeta, name, type, TOOLING_SOURCE, TOOLING_CONFIDENCE);
            const entry = entryByKey.get(`${chunk.file}::${chunk.name}`);
            if (entry) {
              const existing = entry.paramTypes?.[name] || [];
              entry.paramTypes = entry.paramTypes || {};
              entry.paramTypes[name] = uniqueTypes([...(existing || []), type]);
            }
          }
        }
      }
    }

    if (enableRiskCorrelation && callLinks.length) {
      const callerRisk = chunk.docmeta?.risk;
      const callerSources = Array.isArray(callerRisk?.sources) ? callerRisk.sources : [];
      if (callerSources.length) {
        for (const link of callLinks) {
          const calleeChunk = chunkByKey.get(`${link.file}::${link.target}`);
          const calleeRisk = calleeChunk?.docmeta?.risk;
          const calleeSinks = Array.isArray(calleeRisk?.sinks) ? calleeRisk.sinks : [];
          if (!calleeSinks.length) continue;
          const risk = normalizeRisk(chunk);
          for (const sink of calleeSinks) {
            if (sink.category) addUnique(risk.categories, sink.category);
            const sinkTags = Array.isArray(sink.tags) && sink.tags.length
              ? sink.tags
              : (Array.isArray(calleeRisk?.tags) ? calleeRisk.tags : []);
            sinkTags.forEach((tag) => addUnique(risk.tags, tag));
            if (sink.severity) {
              const currentRank = riskSeverityRank[risk.severity] || 0;
              const sinkRank = riskSeverityRank[sink.severity] || 0;
              if (sinkRank > currentRank) risk.severity = sink.severity;
            }
          }
          for (const source of callerSources) {
            for (const sink of calleeSinks) {
              const flow = {
                source: source.name,
                sink: sink.name,
                category: sink.category || null,
                severity: sink.severity || null,
                scope: 'cross-file',
                via: `${chunk.name}->${link.target}`
              };
              if (addRiskFlow(chunk, risk, flow)) riskFlows += 1;
            }
          }
        }
      }
    }
  }

  return { linkedCalls, linkedUsages, inferredReturns, riskFlows };
}
