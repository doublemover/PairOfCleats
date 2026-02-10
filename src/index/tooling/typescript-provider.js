import fsSync from 'node:fs';
import path from 'node:path';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { loadTypeScript } from './typescript/load.js';
import { createVirtualCompilerHost } from './typescript/host.js';
import { buildScopedSymbolId, buildSignatureKey, buildSymbolId, buildSymbolKey } from '../../shared/identity.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { findUpwards } from '../../shared/fs/find-upwards.js';

const normalizePathKey = (value, useCaseSensitive) => {
  const resolved = path.resolve(value);
  return useCaseSensitive ? resolved : resolved.toLowerCase();
};

const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
};

const createDefaultCompilerOptions = (ts, config) => ({
  allowJs: config?.allowJs !== false,
  checkJs: config?.checkJs !== false,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  skipLibCheck: true,
  noEmit: true,
  strict: false
});

const formatDiagnostic = (ts, diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic?.messageText || '', '\n');
  if (diagnostic?.file?.fileName) return `${diagnostic.file.fileName}: ${message}`;
  return message;
};

const resolveTsconfigOverride = (rootDir, toolingConfig, log) => {
  const override = toolingConfig?.typescript?.tsconfigPath;
  if (!override) return null;
  const resolved = isAbsolutePathNative(override) ? override : path.join(rootDir, override);
  if (fsSync.existsSync(resolved)) return resolved;
  log(`[index] TypeScript tsconfig not found at ${resolved}; falling back.`);
  return null;
};

const CONFIG_FILENAMES = ['tsconfig.json', 'jsconfig.json'];

const findNearestConfig = (startDir, repoRoot, cache, useCaseSensitive) => {
  if (!startDir) return null;
  const visited = [];
  let resolved = null;
  findUpwards(
    startDir,
    (candidateDir) => {
      const currentKey = normalizePathKey(candidateDir, useCaseSensitive);
      if (cache.has(currentKey)) {
        resolved = cache.get(currentKey) || null;
        return true;
      }
      visited.push(currentKey);
      for (const filename of CONFIG_FILENAMES) {
        const candidate = path.join(candidateDir, filename);
        if (fsSync.existsSync(candidate)) {
          resolved = candidate;
          return true;
        }
      }
      return false;
    },
    repoRoot || startDir
  );
  for (const key of visited) cache.set(key, resolved);
  return resolved;
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

const isFunctionLike = (ts, node) => (
  ts.isFunctionDeclaration(node)
  || ts.isFunctionExpression(node)
  || ts.isArrowFunction(node)
  || ts.isMethodDeclaration(node)
  || ts.isConstructorDeclaration(node)
);

const getNodeName = (ts, node, sourceFile) => {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isMethodDeclaration(node) && node.name) return getIdentifierName(ts, node.name);
  if (ts.isClassDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isInterfaceDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isTypeAliasDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isEnumDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
};

const kindMatches = (ts, node, hint) => {
  if (!hint) return false;
  const normalized = String(hint).toLowerCase();
  if (normalized === 'function') return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
  if (normalized === 'method') return ts.isMethodDeclaration(node);
  if (normalized === 'class') return ts.isClassDeclaration(node);
  if (normalized === 'interface') return ts.isInterfaceDeclaration(node);
  if (normalized === 'type') return ts.isTypeAliasDeclaration(node);
  if (normalized === 'enum') return ts.isEnumDeclaration(node);
  if (normalized === 'variable') return ts.isVariableDeclaration(node);
  return false;
};

const collectCandidates = (ts, sourceFile, range, hint) => {
  const candidates = [];
  const visit = (node) => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (range && end > range.start && start < range.end) {
      const overlap = Math.min(end, range.end) - Math.max(start, range.start);
      if (overlap > 0) {
        const span = end - start;
        const overlapRatio = overlap / Math.max(1, range.end - range.start);
        const name = getNodeName(ts, node, sourceFile);
        const score = (overlapRatio * 10)
          + (kindMatches(ts, node, hint?.kind) ? 2 : 0)
          + (hint?.name && name && name === hint.name ? 2 : 0)
          - (span / 1000000);
        candidates.push({ node, score, span, name });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
};

const collectNamedCandidates = (ts, sourceFile, name, hint) => {
  if (!name) return [];
  const candidates = [];
  const visit = (node) => {
    const nodeName = getNodeName(ts, node, sourceFile);
    if (nodeName && nodeName === name) {
      if (!hint?.kind || kindMatches(ts, node, hint.kind)) {
        candidates.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
};

const selectBestCandidate = (candidates) => {
  if (!candidates.length) return { node: null, status: 'missing' };
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.span !== b.span) return a.span - b.span;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  if (candidates.length > 1 && Math.abs(candidates[0].score - candidates[1].score) < 1e-6) {
    return { node: null, status: 'ambiguous' };
  }
  return { node: candidates[0].node, status: 'ok' };
};

const findNodeForTarget = (ts, sourceFile, target, strict) => {
  const candidates = collectCandidates(ts, sourceFile, target.virtualRange, target.symbolHint || null);
  const best = selectBestCandidate(candidates);
  if (best.node) return best;
  if (strict) return best;
  if (target?.symbolHint?.name) {
    const nameMatches = collectNamedCandidates(
      ts,
      sourceFile,
      target.symbolHint.name,
      target.symbolHint
    );
    if (nameMatches.length === 1) return { node: nameMatches[0], status: 'ok' };
    if (nameMatches.length > 1) return { node: null, status: 'ambiguous' };
  }
  return best;
};

const extractTypes = (ts, checker, sourceFile, node) => {
  if (!node) return null;
  if (!isFunctionLike(ts, node)) return null;
  const signature = checker.getSignatureFromDeclaration(node);
  if (!signature) return null;
  const returnType = normalizeTypeText(checker.typeToString(checker.getReturnTypeOfSignature(signature), node));
  const paramTypes = {};
  for (const param of node.parameters || []) {
    let paramName = null;
    if (param?.name) {
      if (ts.isIdentifier(param.name)) {
        paramName = param.name.text;
      } else if (typeof param.name.getText === 'function') {
        paramName = param.name.getText(sourceFile).replace(/\s+/g, '').trim() || null;
      }
    }
    if (!paramName) continue;
    const typeText = normalizeTypeText(checker.typeToString(checker.getTypeAtLocation(param), param));
    if (!typeText) continue;
    const confidence = param.type ? 0.95 : (typeText === 'any' || typeText === 'unknown' ? 0.5 : 0.7);
    if (!paramTypes[paramName]) paramTypes[paramName] = [];
    paramTypes[paramName].push({ type: typeText, confidence, source: 'tooling' });
  }
  const signatureText = normalizeTypeText(checker.signatureToString(signature, node));
  return { returnType, paramTypes, signature: signatureText };
};

export const createTypeScriptProvider = () => ({
  id: 'typescript',
  version: '2.0.0',
  label: 'TypeScript',
  priority: 10,
  languages: ['typescript', 'tsx', 'javascript', 'jsx'],
  kinds: ['types'],
  requires: { module: 'typescript' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: true,
    supportsTypeScript: true,
    supportsSymbolRef: true
  },
  getConfigHash(ctx) {
    return hashProviderConfig({
      typescript: ctx?.toolingConfig?.typescript || {},
      strict: ctx?.strict !== false
    });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
    const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'typescript' });
    const baseDiagnostics = appendDiagnosticChecks(null, duplicateChecks);
    if (ctx?.toolingConfig?.typescript?.enabled === false) {
      log({ level: 'info', message: 'TypeScript tooling disabled.' });
      return { provider: { id: 'typescript', version: '2.0.0', configHash: this.getConfigHash(ctx) }, byChunkUid: {}, diagnostics: baseDiagnostics };
    }
    const ts = await loadTypeScript(ctx?.toolingConfig, ctx?.repoRoot);
    if (!ts) {
      log({ level: 'warn', message: 'TypeScript tooling not detected; skipping.' });
      return { provider: { id: 'typescript', version: '2.0.0', configHash: this.getConfigHash(ctx) }, byChunkUid: {}, diagnostics: baseDiagnostics };
    }
    const config = ctx?.toolingConfig?.typescript || {};
    const useCaseSensitive = typeof ts?.sys?.useCaseSensitiveFileNames === 'boolean'
      ? ts.sys.useCaseSensitiveFileNames
      : process.platform !== 'win32';
    const allowJs = config.allowJs !== false;
    const includeJsx = config.includeJsx !== false;
    const allowedExts = new Set([
      '.ts', '.tsx', '.mts', '.cts',
      ...(allowJs ? ['.js', '.mjs', '.cjs'] : []),
      ...(allowJs && includeJsx ? ['.jsx'] : [])
    ]);
    const rootDocs = documents.filter((doc) => allowedExts.has(String(doc.effectiveExt || '').toLowerCase()));
    if (!rootDocs.length) {
      return {
        provider: { id: 'typescript', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: baseDiagnostics
      };
    }

    const maxFiles = Number.isFinite(config.maxFiles) ? Math.max(1, config.maxFiles) : null;
    const maxProgramFiles = Number.isFinite(config.maxProgramFiles) ? Math.max(1, config.maxProgramFiles) : null;
    const maxFileBytes = Number.isFinite(config.maxFileBytes) ? Math.max(1, config.maxFileBytes) : null;

    const configOverride = resolveTsconfigOverride(ctx.repoRoot, ctx.toolingConfig, (message) => log({ level: 'warn', message }));
    const useTsconfig = config.useTsconfig !== false;
    const configCache = new Map();
    const configGroups = new Map();
    const orderedDocs = rootDocs.slice().sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));
    for (const doc of orderedDocs) {
      const containerPath = doc.containerPath || doc.virtualPath;
      const containerDir = path.dirname(path.resolve(ctx.repoRoot, containerPath));
      const configPath = configOverride
        ? configOverride
        : (useTsconfig ? findNearestConfig(containerDir, ctx.repoRoot, configCache, useCaseSensitive) : null);
      const key = configPath || '__default__';
      const group = configGroups.get(key) || { configPath, documents: [] };
      group.documents.push(doc);
      configGroups.set(key, group);
    }

    const byChunkUid = {};
    const diagnostics = [];
    if (duplicateChecks.length) diagnostics.push(...duplicateChecks);
    const targetsByDoc = new Map();
    for (const target of targets) {
      const chunkRef = target?.chunkRef || target?.chunk || null;
      if (!target?.virtualPath || !chunkRef?.chunkUid) continue;
      const list = targetsByDoc.get(target.virtualPath) || [];
      list.push({ ...target, chunkRef });
      targetsByDoc.set(target.virtualPath, list);
    }

    const parsedConfigCache = new Map();
    const compilerDefaults = createDefaultCompilerOptions(ts, config);
    for (const group of configGroups.values()) {
      const groupDocs = group.documents || [];
      if (maxFiles && groupDocs.length > maxFiles) {
        diagnostics.push({
          name: 'cap_maxFiles',
          status: 'warn',
          message: `TypeScript provider skipped ${groupDocs.length} docs (maxFiles=${maxFiles}).`
        });
        continue;
      }
      if (maxFileBytes) {
        const oversized = groupDocs.find((doc) => Buffer.byteLength(doc.text || '', 'utf8') > maxFileBytes);
        if (oversized) {
          diagnostics.push({
            name: 'cap_maxFileBytes',
            status: 'warn',
            message: `TypeScript provider skipped ${oversized.virtualPath} (size > ${maxFileBytes}).`
          });
          continue;
        }
      }

      let parsedConfig = null;
      if (group.configPath) {
        if (parsedConfigCache.has(group.configPath)) {
          parsedConfig = parsedConfigCache.get(group.configPath);
        } else {
          parsedConfig = parseTsConfig(ts, group.configPath, (message) => log({ level: 'warn', message }));
          parsedConfigCache.set(group.configPath, parsedConfig);
        }
      }

      const mergedOptions = parsedConfig?.options
        ? { ...compilerDefaults, ...parsedConfig.options }
        : { ...compilerDefaults };
      // Ensure tooling config overrides win for JS parity.
      mergedOptions.allowJs = compilerDefaults.allowJs;
      mergedOptions.checkJs = compilerDefaults.checkJs;

      const vfsMap = new Map();
      const rootNames = [];
      for (const doc of groupDocs) {
        const absPath = path.resolve(ctx.repoRoot, doc.virtualPath);
        vfsMap.set(normalizePathKey(absPath, useCaseSensitive), doc.text);
        rootNames.push(absPath);
      }
      const finalRootNames = parsedConfig?.fileNames
        ? Array.from(new Set([...parsedConfig.fileNames, ...rootNames]))
        : rootNames;

      if (maxProgramFiles && finalRootNames.length > maxProgramFiles) {
        diagnostics.push({
          name: 'cap_maxProgramFiles',
          status: 'warn',
          message: `TypeScript provider skipped program with ${finalRootNames.length} files (maxProgramFiles=${maxProgramFiles}).`
        });
        continue;
      }

      const host = createVirtualCompilerHost(ts, mergedOptions, vfsMap);
      const program = ts.createProgram({ rootNames: finalRootNames, options: mergedOptions, host });
      const checker = program.getTypeChecker();

      for (const doc of groupDocs) {
        const absPath = path.resolve(ctx.repoRoot, doc.virtualPath);
        const sourceFile = program.getSourceFile(absPath);
        if (!sourceFile) continue;
        const docTargets = targetsByDoc.get(doc.virtualPath) || [];
        for (const target of docTargets) {
          const result = findNodeForTarget(ts, sourceFile, target, ctx?.strict !== false);
          if (!result.node) {
            diagnostics.push({
              name: 'node_match',
              status: result.status === 'ambiguous' ? 'warn' : 'error',
              message: `TypeScript target ${result.status} for ${target.chunkRef.chunkUid}`
            });
            continue;
          }
          const extracted = extractTypes(ts, checker, sourceFile, result.node);
          if (!extracted) continue;
          const nodeName = getNodeName(ts, result.node, sourceFile) || target?.symbolHint?.name || null;
          const kindGroup = target?.symbolHint?.kind || null;
          const symbolKey = buildSymbolKey({
            virtualPath: target.virtualPath,
            qualifiedName: nodeName,
            kindGroup
          });
          const signatureKey = buildSignatureKey({ qualifiedName: nodeName, signature: extracted.signature });
          const scopedId = buildScopedSymbolId({
            kindGroup: kindGroup || 'other',
            symbolKey,
            signatureKey,
            chunkUid: target.chunkRef?.chunkUid || null
          });
          const symbolId = buildSymbolId({ scopedId, scheme: 'heur' });
          const symbolRef = symbolKey ? {
            symbolKey,
            symbolId,
            signatureKey,
            scopedId,
            kind: target?.symbolHint?.kind || null,
            qualifiedName: nodeName,
            languageId: doc.languageId || null,
            definingChunk: target.chunkRef || null,
            evidence: { scheme: 'heur', confidence: result.status === 'ok' ? 'medium' : 'low' }
          } : null;
          byChunkUid[target.chunkRef.chunkUid] = {
            chunk: target.chunkRef,
            payload: {
              returnType: extracted.returnType,
              paramTypes: extracted.paramTypes,
              signature: extracted.signature
            },
            ...(symbolRef ? { symbolRef } : {}),
            provenance: {
              provider: 'typescript',
              version: '2.0.0',
              collectedAt: new Date().toISOString()
            }
          };
        }
      }
    }

    return {
      provider: { id: 'typescript', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid,
      diagnostics: diagnostics.length ? { checks: diagnostics } : null
    };
  }
});
