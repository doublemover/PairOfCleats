import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonFileSafe } from '../../shared/files.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { classifyLspDocumentPathPolicy } from '../../integrations/tooling/providers/lsp/path-policy.js';
import { findWorkspaceMarkersNearPaths } from './workspace-model.js';

const PYRIGHT_WORKSPACE_MARKER_OPTIONS = Object.freeze({
  exactNames: Object.freeze(['pyrightconfig.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'])
});

const normalizeWorkspaceRootRel = (value) => {
  const normalized = String(value || '.')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || '.';
};

const normalizeVirtualPath = (value) => (
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.poc-vfs\/+/iu, '')
    .replace(/^poc-vfs\/+/iu, '')
    .replace(/#.*$/u, '')
);

const countSymbolSeeds = (text) => {
  const source = String(text || '');
  if (!source) return 0;
  const matches = source.match(/^\s*(?:async\s+def|def|class)\s+[A-Za-z_][A-Za-z0-9_]*/gmu);
  return Array.isArray(matches) ? matches.length : 0;
};

const buildHealthFingerprint = ({ repoRoot, workspaceRootRel }) => crypto.createHash('sha1')
  .update(path.resolve(String(repoRoot || process.cwd())).toLowerCase())
  .update('|')
  .update(normalizeWorkspaceRootRel(workspaceRootRel))
  .digest('hex');

const resolvePlannerHealthPath = ({ repoRoot, cacheRoot = null, workspaceRootRel }) => {
  const rootHash = buildHealthFingerprint({ repoRoot, workspaceRootRel });
  if (typeof cacheRoot === 'string' && cacheRoot.trim()) {
    return path.join(path.resolve(cacheRoot), 'tooling', 'pyright-planner', `${rootHash}.json`);
  }
  return path.join(
    path.resolve(String(repoRoot || process.cwd())),
    '.build',
    'pairofcleats',
    'tooling',
    'pyright-planner',
    `${rootHash}.json`
  );
};

const readPlannerHealth = async ({ repoRoot, cacheRoot = null, workspaceRootRel }) => {
  const healthPath = resolvePlannerHealthPath({ repoRoot, cacheRoot, workspaceRootRel });
  const payload = await readJsonFileSafe(healthPath, {
    fallback: null,
    maxBytes: 32 * 1024
  });
  if (!payload || typeof payload !== 'object') {
    return { healthPath, state: null };
  }
  return {
    healthPath,
    state: {
      workspaceRootRel: normalizeWorkspaceRootRel(payload.workspaceRootRel),
      documentSymbolTimeouts: Number(payload.documentSymbolTimeouts) || 0,
      documentSymbolFailures: Number(payload.documentSymbolFailures) || 0,
      documentSymbolP95Ms: Number(payload.documentSymbolP95Ms) || 0,
      updatedAt: String(payload.updatedAt || '').trim() || null
    }
  };
};

export const persistPyrightPlannerHealth = async ({
  repoRoot,
  cacheRoot = null,
  workspaceRootRel,
  runtime = null
} = {}) => {
  const method = runtime?.requests?.byMethod?.['textDocument/documentSymbol'] || {};
  const payload = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    workspaceRootRel: normalizeWorkspaceRootRel(workspaceRootRel),
    documentSymbolTimeouts: Number(method?.timedOut || 0),
    documentSymbolFailures: Number(method?.failed || 0),
    documentSymbolP95Ms: Number(method?.latencyMs?.p95 || 0)
  };
  const healthPath = resolvePlannerHealthPath({ repoRoot, cacheRoot, workspaceRootRel });
  await fs.promises.mkdir(path.dirname(healthPath), { recursive: true });
  await atomicWriteJson(healthPath, payload, {
    spaces: 0,
    newline: false
  });
  return healthPath;
};

const resolveHealthLevel = (state) => {
  const timeouts = Number(state?.documentSymbolTimeouts || 0);
  const failures = Number(state?.documentSymbolFailures || 0);
  const p95Ms = Number(state?.documentSymbolP95Ms || 0);
  if (timeouts >= 3 || failures >= 4 || p95Ms >= 3000) return 'severe';
  if (timeouts >= 1 || failures >= 2 || p95Ms >= 2200) return 'moderate';
  return 'healthy';
};

const resolveMixedLanguagePressure = (allDocuments, pythonDocuments) => {
  const allDocs = Array.isArray(allDocuments) ? allDocuments : [];
  const pythonCount = Array.isArray(pythonDocuments) ? pythonDocuments.length : 0;
  const nonPythonCount = Math.max(0, allDocs.length - pythonCount);
  if (nonPythonCount <= 0) return 'none';
  if (nonPythonCount >= Math.max(4, pythonCount)) return 'high';
  return 'moderate';
};

const resolveWorkspaceRootRelForDoc = ({
  repoRoot,
  virtualPath,
  workspaceRootByVirtualPath = null
}) => {
  const normalizedPath = normalizeVirtualPath(virtualPath);
  if (!normalizedPath) return '.';
  if (workspaceRootByVirtualPath && typeof workspaceRootByVirtualPath === 'object') {
    const explicit = workspaceRootByVirtualPath[virtualPath] || workspaceRootByVirtualPath[normalizedPath];
    if (explicit) return normalizeWorkspaceRootRel(explicit);
  }
  const matches = findWorkspaceMarkersNearPaths(
    String(repoRoot || process.cwd()),
    [normalizedPath],
    PYRIGHT_WORKSPACE_MARKER_OPTIONS
  );
  if (matches.length > 0) {
    return normalizeWorkspaceRootRel(matches[0]?.markerDirRel || '.');
  }
  return '.';
};

const resolveDocWorkspacePartitions = ({
  repoRoot,
  documents,
  targetsByPath,
  workspaceRootByVirtualPath = null
}) => {
  const entries = [];
  const partitions = new Map();
  for (const doc of Array.isArray(documents) ? documents : []) {
    const virtualPath = String(doc?.virtualPath || '').trim();
    if (!virtualPath) continue;
    const targetCount = (targetsByPath.get(virtualPath) || []).length;
    const pathPolicy = classifyLspDocumentPathPolicy({
      providerId: 'pyright',
      virtualPath
    });
    const workspaceRootRel = resolveWorkspaceRootRelForDoc({
      repoRoot,
      virtualPath,
      workspaceRootByVirtualPath
    });
    const symbolSeedCount = countSymbolSeeds(doc?.text || '');
    const byteLength = Buffer.byteLength(String(doc?.text || ''), 'utf8');
    const entry = {
      doc,
      virtualPath,
      targetCount,
      pathPolicy,
      workspaceRootRel,
      symbolSeedCount,
      byteLength
    };
    entries.push(entry);
    const partition = partitions.get(workspaceRootRel) || {
      workspaceRootRel,
      docs: [],
      preferredTargetBearingDocs: 0,
      preferredTargetCount: 0,
      preferredSymbolSeeds: 0,
      contributableDocs: 0,
      contributableTargetCount: 0,
      totalSymbolSeeds: 0,
      totalDocs: 0,
      lowValueDocs: 0
    };
    partition.docs.push(entry);
    partition.totalDocs += 1;
    partition.totalSymbolSeeds += symbolSeedCount;
    if (pathPolicy.skipDocumentSymbol) {
      partition.lowValueDocs += 1;
    } else if (!pathPolicy.skipDocument) {
      partition.contributableDocs += 1;
      partition.contributableTargetCount += targetCount;
      if (pathPolicy.selectionTier === 'preferred') {
        partition.preferredTargetBearingDocs += targetCount > 0 ? 1 : 0;
        partition.preferredTargetCount += targetCount;
        partition.preferredSymbolSeeds += symbolSeedCount;
      }
    }
    partitions.set(workspaceRootRel, partition);
  }
  const orderedPartitions = Array.from(partitions.values())
    .sort((left, right) => (
      right.preferredTargetBearingDocs - left.preferredTargetBearingDocs
      || right.preferredTargetCount - left.preferredTargetCount
      || right.preferredSymbolSeeds - left.preferredSymbolSeeds
      || right.contributableDocs - left.contributableDocs
      || right.contributableTargetCount - left.contributableTargetCount
      || right.totalSymbolSeeds - left.totalSymbolSeeds
      || left.lowValueDocs - right.lowValueDocs
      || right.totalDocs - left.totalDocs
      || left.workspaceRootRel.localeCompare(right.workspaceRootRel)
    ));
  return {
    entries,
    partitions: orderedPartitions,
    chosenWorkspaceRootRel: orderedPartitions[0]?.workspaceRootRel || '.'
  };
};

const rankPlannerEntry = (entry) => (
  [
    entry.bucket === 'must_collect' ? 0 : 1,
    entry.pathPolicy.selectionTier === 'preferred' ? 0 : (entry.pathPolicy.selectionTier === 'secondary' ? 1 : 2),
    -entry.targetCount,
    -entry.symbolSeedCount,
    entry.byteLength,
    entry.virtualPath
  ]
);

const compareRankedEntries = (left, right) => {
  const leftRank = rankPlannerEntry(left);
  const rightRank = rankPlannerEntry(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] < rightRank[index]) return -1;
    if (leftRank[index] > rightRank[index]) return 1;
  }
  return 0;
};

const summarizeDecisions = (decisions) => {
  const countsByReason = Object.create(null);
  const countsByBucket = Object.create(null);
  for (const entry of decisions) {
    const reasonCode = String(entry.reasonCode || 'selected');
    countsByReason[reasonCode] = Number(countsByReason[reasonCode] || 0) + 1;
    const bucket = String(entry.bucket || 'skip');
    countsByBucket[bucket] = Number(countsByBucket[bucket] || 0) + 1;
  }
  return {
    countsByReason,
    countsByBucket
  };
};

export const __resolvePyrightRequestPlanForTests = ({
  repoRoot,
  documents,
  targets,
  allDocuments = null,
  persistedHealth = null,
  workspaceRootByVirtualPath = null
} = {}) => {
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  const targetsByPath = new Map();
  for (const target of targetList) {
    const virtualPath = String(target?.virtualPath || '').trim();
    if (!virtualPath) continue;
    const list = targetsByPath.get(virtualPath) || [];
    list.push(target);
    targetsByPath.set(virtualPath, list);
  }

  const {
    entries,
    partitions,
    chosenWorkspaceRootRel
  } = resolveDocWorkspacePartitions({
    repoRoot,
    documents: docs,
    targetsByPath,
    workspaceRootByVirtualPath
  });

  const healthLevel = resolveHealthLevel(persistedHealth);
  const mixedLanguagePressure = resolveMixedLanguagePressure(allDocuments, docs);
  let docBudget = 96;
  let targetBudget = 384;
  let documentSymbolConcurrency = 4;
  let perDocByteCeiling = 120 * 1024;

  if (mixedLanguagePressure === 'moderate') {
    docBudget = Math.min(docBudget, 64);
    targetBudget = Math.min(targetBudget, 256);
    documentSymbolConcurrency = Math.min(documentSymbolConcurrency, 3);
    perDocByteCeiling = Math.min(perDocByteCeiling, 96 * 1024);
  } else if (mixedLanguagePressure === 'high') {
    docBudget = Math.min(docBudget, 40);
    targetBudget = Math.min(targetBudget, 160);
    documentSymbolConcurrency = Math.min(documentSymbolConcurrency, 2);
    perDocByteCeiling = Math.min(perDocByteCeiling, 72 * 1024);
  }

  if (healthLevel === 'moderate') {
    docBudget = Math.min(docBudget, 48);
    targetBudget = Math.min(targetBudget, 192);
    documentSymbolConcurrency = Math.min(documentSymbolConcurrency, 2);
    perDocByteCeiling = Math.min(perDocByteCeiling, 80 * 1024);
  } else if (healthLevel === 'severe') {
    docBudget = Math.min(docBudget, 24);
    targetBudget = Math.min(targetBudget, 96);
    documentSymbolConcurrency = 1;
    perDocByteCeiling = Math.min(perDocByteCeiling, 56 * 1024);
  }

  const decisions = [];
  for (const entry of entries) {
    let bucket = 'skip';
    let reasonCode = 'low_symbol_yield';
    if (entry.workspaceRootRel !== chosenWorkspaceRootRel) {
      reasonCode = 'workspace_mismatch';
    } else if (entry.pathPolicy.skipDocument) {
      reasonCode = 'path_policy_skip';
    } else if (entry.pathPolicy.skipDocumentSymbol) {
      reasonCode = 'path_policy_low_value';
    } else if (entry.targetCount <= 0) {
      reasonCode = 'no_targets';
    } else if (healthLevel === 'severe' && entry.pathPolicy.deprioritized) {
      reasonCode = 'health_suppressed';
    } else if (
      entry.byteLength > perDocByteCeiling
      && entry.targetCount <= 1
      && entry.symbolSeedCount < 3
    ) {
      reasonCode = 'per_doc_cost_ceiling';
    } else if (
      entry.targetCount >= 2
      || (entry.symbolSeedCount >= 2 && entry.pathPolicy.selectionTier === 'preferred')
    ) {
      bucket = 'must_collect';
      reasonCode = 'must_collect';
    } else if (entry.symbolSeedCount >= 1 || entry.targetCount >= 1) {
      bucket = 'collect_if_budget_allows';
      reasonCode = 'budget_candidate';
    }
    decisions.push({
      ...entry,
      bucket,
      reasonCode
    });
  }

  const selectedEntries = [];
  let selectedTargetCount = 0;
  for (const entry of decisions
    .filter((decision) => decision.bucket !== 'skip')
    .sort(compareRankedEntries)) {
    const wouldExceedDocBudget = selectedEntries.length >= docBudget;
    const wouldExceedTargetBudget = selectedEntries.length > 0 && (selectedTargetCount + entry.targetCount) > targetBudget;
    if (wouldExceedDocBudget || wouldExceedTargetBudget) {
      entry.bucket = 'skip';
      entry.reasonCode = 'budget_capped';
      continue;
    }
    selectedEntries.push(entry);
    selectedTargetCount += entry.targetCount;
  }

  const selectedPathSet = new Set(selectedEntries.map((entry) => entry.virtualPath));
  const selectedDocuments = selectedEntries.map((entry) => entry.doc);
  const selectedTargets = targetList.filter((target) => selectedPathSet.has(String(target?.virtualPath || '').trim()));
  const decisionSummary = summarizeDecisions(decisions);
  const skippedDocuments = decisions
    .filter((entry) => entry.bucket === 'skip')
    .map((entry) => ({
      virtualPath: entry.virtualPath,
      workspaceRootRel: entry.workspaceRootRel,
      reasonCode: entry.reasonCode,
      targetCount: entry.targetCount,
      symbolSeedCount: entry.symbolSeedCount,
      byteLength: entry.byteLength
    }));
  const selectedDocumentSummaries = selectedEntries.map((entry) => ({
    virtualPath: entry.virtualPath,
    workspaceRootRel: entry.workspaceRootRel,
    bucket: entry.bucket,
    targetCount: entry.targetCount,
    symbolSeedCount: entry.symbolSeedCount,
    byteLength: entry.byteLength
  }));

  const checks = [];
  if (partitions.length > 1) {
    checks.push({
      name: 'pyright_workspace_partition_narrowed',
      status: 'warn',
      message: `pyright narrowed documentSymbol planning to workspace root "${chosenWorkspaceRootRel}" out of ${partitions.length} candidate partitions.`
    });
  }
  if (decisionSummary.countsByReason.workspace_mismatch > 0) {
    checks.push({
      name: 'pyright_workspace_partition_mismatch',
      status: 'warn',
      message: `pyright skipped ${decisionSummary.countsByReason.workspace_mismatch} document(s) outside the effective workspace partition.`
    });
  }
  if (decisionSummary.countsByReason.budget_capped > 0) {
    checks.push({
      name: 'pyright_document_symbol_budget_capped',
      status: 'warn',
      message: `pyright planner skipped ${decisionSummary.countsByReason.budget_capped} document(s) after exhausting provider-local budget.`
    });
  }
  if (healthLevel !== 'healthy') {
    checks.push({
      name: 'pyright_health_suppressed',
      status: 'warn',
      message: `pyright planner applied ${healthLevel} health suppression for workspace "${chosenWorkspaceRootRel}".`
    });
  }
  if (mixedLanguagePressure !== 'none') {
    checks.push({
      name: 'pyright_mixed_language_pressure',
      status: mixedLanguagePressure === 'high' ? 'warn' : 'info',
      message: `pyright planner detected ${mixedLanguagePressure} mixed-language pressure and tightened documentSymbol admission.`
    });
  }

  return {
    workspaceRootRel: chosenWorkspaceRootRel,
    workspaceRootDir: path.join(String(repoRoot || process.cwd()), chosenWorkspaceRootRel === '.' ? '' : chosenWorkspaceRootRel),
    persistedHealth,
    healthLevel,
    mixedLanguagePressure,
    documentSymbolConcurrency,
    docBudget,
    targetBudget,
    perDocByteCeiling,
    selectedDocuments,
    selectedTargets,
    selectedDocumentSummaries,
    skippedDocuments,
    checks,
    diagnostics: {
      workspaceRootRel: chosenWorkspaceRootRel,
      workspacePartitionCount: partitions.length,
      healthLevel,
      mixedLanguagePressure,
      docBudget,
      targetBudget,
      documentSymbolConcurrency,
      perDocByteCeiling,
      selectedDocuments: selectedDocumentSummaries,
      skippedDocuments,
      countsByReason: decisionSummary.countsByReason,
      countsByBucket: decisionSummary.countsByBucket
    }
  };
};

export const resolvePyrightRequestPlan = async ({
  repoRoot,
  cacheRoot = null,
  documents,
  targets,
  allDocuments = null
} = {}) => {
  const initialPlan = __resolvePyrightRequestPlanForTests({
    repoRoot,
    documents,
    targets,
    allDocuments,
    persistedHealth: null
  });
  const health = await readPlannerHealth({
    repoRoot,
    cacheRoot,
    workspaceRootRel: initialPlan.workspaceRootRel
  });
  const nextPlan = __resolvePyrightRequestPlanForTests({
    repoRoot,
    documents,
    targets,
    allDocuments,
    persistedHealth: health.state
  });
  return {
    ...nextPlan,
    healthPath: health.healthPath
  };
};
