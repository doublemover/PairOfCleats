import { createTypeScriptNodeIndex } from './typescript/node-index.js';
import path from 'node:path';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { loadTypeScript } from './typescript/load.js';
import { createVirtualCompilerHost } from './typescript/host.js';
import { buildScopedSymbolId, buildSignatureKey, buildSymbolId, buildSymbolKey } from '../../shared/identity.js';
import { selectTypeScriptDocuments, createDefaultCompilerOptions, resolveTsconfigOverride, findNearestConfig, parseTsConfig } from './typescript/config.js';

const normalizePathKey = (value, useCaseSensitive) => {
  const resolved = path.resolve(value);
  return useCaseSensitive ? resolved : resolved.toLowerCase();
};

const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
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

const collectCandidates = (ts, index, range, hint) => index.overlapping(range).map(({ node, start, end, name }) => {
  const overlap = Math.min(end, range.end) - Math.max(start, range.start);
  const span = end - start;
  const score = (overlap / Math.max(1, range.end - range.start) * 10)
    + (kindMatches(ts, node, hint?.kind) ? 2 : 0)
    + (hint?.name && name && name === hint.name ? 2 : 0) - (span / 1000000);
  return { node, score, span, name };
});
const collectNamedCandidates = (ts, index, name, hint) => index.named(name)
  .filter(({ node }) => !hint?.kind || kindMatches(ts, node, hint.kind)).map(({ node }) => node);
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

const findNodeForTarget = (ts, target, strict, nodeIndex) => {
  const candidates = collectCandidates(ts, nodeIndex, target.virtualRange, target.symbolHint || null);
  const best = selectBestCandidate(candidates);
  if (best.node) return best;
  if (strict) return best;
  if (target?.symbolHint?.name) {
    const nameMatches = collectNamedCandidates(
      ts,
      nodeIndex,
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
  const paramTypes = Object.create(null);
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
    if (!Object.hasOwn(paramTypes, paramName) || !Array.isArray(paramTypes[paramName])) {
      paramTypes[paramName] = [];
    }
    paramTypes[paramName].push({ type: typeText, confidence, source: 'tooling' });
  }
  const signatureText = normalizeTypeText(checker.signatureToString(signature, node));
  return { returnType, paramTypes, signature: signatureText };
};

const buildTypeScriptDiagnosticCheck = ({
  name,
  status,
  message,
  triggerClass,
  degradedEligible,
  contributionState = 'none'
}) => ({
  name,
  status,
  message,
  triggerClass,
  degradedEligible,
  contributionState
});

export const createTypeScriptProvider = () => ({
  id: 'typescript',
  version: '2.4.0',
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
      return { provider: { id: 'typescript', version: '2.4.0', configHash: this.getConfigHash(ctx) }, byChunkUid: {}, diagnostics: baseDiagnostics };
    }
    const ts = await loadTypeScript(ctx?.toolingConfig, ctx?.repoRoot);
    if (!ts) {
      log({ level: 'warn', message: 'TypeScript tooling not detected; skipping.' });
      return {
        provider: { id: 'typescript', version: '2.4.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(baseDiagnostics, [
          buildTypeScriptDiagnosticCheck({
            name: 'typescript_runtime_unavailable',
            status: 'error',
            message: 'TypeScript runtime module not found.',
            triggerClass: 'runtime_unavailable',
            degradedEligible: true
          })
        ])
      };
    }
    const config = ctx?.toolingConfig?.typescript || {};
    const useCaseSensitive = typeof ts?.sys?.useCaseSensitiveFileNames === 'boolean'
      ? ts.sys.useCaseSensitiveFileNames
      : process.platform !== 'win32';
    const rootDocs = selectTypeScriptDocuments(documents, config);
    if (!rootDocs.length) {
      return {
        provider: { id: 'typescript', version: '2.4.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: baseDiagnostics
      };
    }

    const maxFiles = Number.isFinite(config.maxFiles) ? Math.max(1, config.maxFiles) : null;
    const maxProgramFiles = Number.isFinite(config.maxProgramFiles) ? Math.max(1, config.maxProgramFiles) : null;
    const maxFileBytes = Number.isFinite(config.maxFileBytes) ? Math.max(1, config.maxFileBytes) : null;

    const compilerSystem = ctx.semanticSession?.compilerSystem(ts, rootDocs) || ts.sys;
    const configOverride = resolveTsconfigOverride(ctx.repoRoot, ctx.toolingConfig, (message) => log({ level: 'warn', message }), compilerSystem);
    const useTsconfig = config.useTsconfig !== false;
    const configCache = new Map();
    const configGroups = new Map();
    const orderedDocs = rootDocs.slice().sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));
    for (const doc of orderedDocs) {
      const containerPath = doc.containerPath || doc.virtualPath;
      const containerDir = path.dirname(path.resolve(ctx.repoRoot, containerPath));
      const configPath = configOverride
        ? configOverride
        : (useTsconfig ? findNearestConfig(containerDir, ctx.repoRoot, configCache, useCaseSensitive, compilerSystem) : null);
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
          ...buildTypeScriptDiagnosticCheck({
            name: 'cap_maxFiles',
            status: 'warn',
            message: `TypeScript provider skipped ${groupDocs.length} docs (maxFiles=${maxFiles}).`,
            triggerClass: 'planner_cap',
            degradedEligible: false,
            contributionState: 'skipped'
          }),
          maxFiles,
          skippedDocuments: groupDocs.length
        });
        continue;
      }
      if (maxFileBytes) {
        const oversized = groupDocs.find((doc) => Buffer.byteLength(doc.text || '', 'utf8') > maxFileBytes);
        if (oversized) {
          diagnostics.push({
            ...buildTypeScriptDiagnosticCheck({
              name: 'cap_maxFileBytes',
              status: 'warn',
              message: `TypeScript provider skipped ${oversized.virtualPath} (size > ${maxFileBytes}).`,
              triggerClass: 'planner_cap',
              degradedEligible: false,
              contributionState: 'skipped'
            }),
            maxFileBytes,
            virtualPath: oversized.virtualPath
          });
          continue;
        }
      }

      let parsedConfig = null;
      if (group.configPath) {
        if (parsedConfigCache.has(group.configPath)) {
          parsedConfig = parsedConfigCache.get(group.configPath);
        } else {
          parsedConfig = parseTsConfig(ts, group.configPath, (message) => log({ level: 'warn', message }), compilerSystem);
          parsedConfigCache.set(group.configPath, parsedConfig);
        }
      }

      const mergedOptions = parsedConfig?.options
        ? { ...compilerDefaults, ...parsedConfig.options }
        : { ...compilerDefaults };
      // Ensure tooling config overrides win for JS parity.
      mergedOptions.allowJs = compilerDefaults.allowJs;
      mergedOptions.checkJs = compilerDefaults.checkJs;

      const vfsMap = new Map(), sourcePaths = new Map(), moduleOrigins = new Map();
      const rootNames = [];
      for (const doc of groupDocs) {
        const absPath = path.resolve(ctx.repoRoot, doc.virtualPath);
        vfsMap.set(normalizePathKey(absPath, useCaseSensitive), doc.text);
        if (doc.containerPath) moduleOrigins.set(normalizePathKey(absPath, useCaseSensitive), path.resolve(ctx.repoRoot, doc.containerPath));
        if (doc.containerPath && !doc.segmentUid) sourcePaths.set(normalizePathKey(absPath, useCaseSensitive), path.resolve(ctx.repoRoot, doc.containerPath));
        rootNames.push(absPath);
      }
      const finalRootNames = parsedConfig?.fileNames
        ? Array.from(new Set([...parsedConfig.fileNames, ...rootNames]))
        : rootNames;

      if (maxProgramFiles && finalRootNames.length > maxProgramFiles) {
        diagnostics.push({
          ...buildTypeScriptDiagnosticCheck({
            name: 'cap_maxProgramFiles',
            status: 'warn',
            message: `TypeScript provider skipped program with ${finalRootNames.length} files (maxProgramFiles=${maxProgramFiles}).`,
            triggerClass: 'planner_cap',
            degradedEligible: false,
            contributionState: 'skipped'
          }),
          maxProgramFiles,
          programFiles: finalRootNames.length
        });
        continue;
      }

      const host = createVirtualCompilerHost(ts, mergedOptions, vfsMap, sourcePaths, moduleOrigins, compilerSystem);
      const program = ts.createProgram({ rootNames: finalRootNames, options: mergedOptions, projectReferences: parsedConfig?.projectReferences, host });
      const checker = program.getTypeChecker();
      const semanticGroup = ctx.semanticSession?.beginGroup({ ts, program, options: mergedOptions, documents: groupDocs, configPath: group.configPath });

      for (const doc of groupDocs) {
        const absPath = path.resolve(ctx.repoRoot, doc.virtualPath);
        const sourceFile = program.getSourceFile(absPath);
        if (!sourceFile) continue;
        const nodeIndex = createTypeScriptNodeIndex(ts, sourceFile, getNodeName);
        if (semanticGroup) await ctx.semanticSession.collectDocument({ ts, checker, sourceFile, nodeIndex, group: semanticGroup });
        const docTargets = targetsByDoc.get(doc.virtualPath) || [];
        for (const target of docTargets) {
          const result = findNodeForTarget(ts, target, ctx?.strict !== false, nodeIndex);
          if (!result.node) {
            diagnostics.push({
              ...buildTypeScriptDiagnosticCheck({
                name: 'node_match',
                status: result.status === 'ambiguous' ? 'warn' : 'error',
                message: `TypeScript target ${result.status} for ${target.chunkRef.chunkUid}`,
                triggerClass: 'planner_target_match',
                degradedEligible: false,
                contributionState: 'skipped'
              }),
              targetStatus: result.status,
              chunkUid: target.chunkRef.chunkUid,
              virtualPath: target.virtualPath || null
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
              version: '2.4.0',
              collectedAt: new Date().toISOString()
            }
          };
        }
      }
      if (semanticGroup) await ctx.semanticSession.finishGroup(semanticGroup);
    }

    return {
      provider: { id: 'typescript', version: '2.4.0', configHash: this.getConfigHash(ctx) },
      byChunkUid,
      ...(ctx.semanticSession ? { semanticFacts: ctx.semanticSession.output() } : {}),
      diagnostics: diagnostics.length ? { checks: diagnostics } : null
    };
  }
});
