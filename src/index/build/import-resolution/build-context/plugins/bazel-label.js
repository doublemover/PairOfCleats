import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';
import { IMPORT_RESOLUTION_TRACE_STAGES } from '../../trace-model.js';
import { buildBazelLabelCandidatePaths } from '../../resolvers/common-paths.js';

const createEntryIndex = (entries = []) => {
  const byRel = new Set();
  for (const entry of entries) {
    const rel = typeof entry === 'string' ? entry : entry?.rel;
    if (typeof rel === 'string' && rel.trim()) byRel.add(rel.trim().replace(/\\/g, '/'));
  }
  return byRel;
};

const packageExistsInEntrySet = ({ entrySet, packageRel }) => {
  if (!packageRel) return true;
  for (const rel of entrySet) {
    if (rel === packageRel || rel === `${packageRel}.bzl`) return true;
    if (rel.startsWith(`${packageRel}/`)) return true;
  }
  return false;
};

export const createBazelLabelPlugin = ({ entries = [] } = {}) => {
  const entrySet = createEntryIndex(entries);
  const classify = ({ spec = '', rawSpec = '', importerRel = '' } = {}) => {
    const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
    const importerInfo = {
      importerRel,
      importerDir: importerRel.includes('/') ? importerRel.slice(0, importerRel.lastIndexOf('/')) : '',
      extension: importerRel.includes('.') ? importerRel.slice(importerRel.lastIndexOf('.')).toLowerCase() : ''
    };
    const labelInfo = buildBazelLabelCandidatePaths({
      rawSpec: targetSpecifier || rawSpec,
      importerInfo
    });
    if (!labelInfo?.parsed) return null;
    const candidatePaths = Array.isArray(labelInfo.candidates) ? labelInfo.candidates.slice() : [];
    const targetExists = candidatePaths.some((candidate) => entrySet.has(candidate));
    const packageExists = packageExistsInEntrySet({
      entrySet,
      packageRel: labelInfo.packageRel
    });
    const parsed = labelInfo.parsed;
    const details = {
      labelKind: parsed.kind,
      repo: parsed.repo || null,
      packageRel: labelInfo.packageRel || '',
      targetRel: labelInfo.targetRel || '',
      candidatePaths,
      packageExists,
      targetExists
    };
    if (parsed.repo) {
      return {
        reasonCode: IMPORT_REASON_CODES.BAZEL_EXTERNAL_REPOSITORY_UNAVAILABLE,
        pluginId: 'bazel-label',
        adapter: 'bazel-label',
        traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
        details
      };
    }
    if (!packageExists) {
      return {
        reasonCode: IMPORT_REASON_CODES.BAZEL_LABEL_PACKAGE_MISSING,
        pluginId: 'bazel-label',
        adapter: 'bazel-label',
        traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
        details
      };
    }
    if (!targetExists) {
      return {
        reasonCode: IMPORT_REASON_CODES.BAZEL_LABEL_TARGET_MISSING,
        pluginId: 'bazel-label',
        adapter: 'bazel-label',
        traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
        details
      };
    }
    return {
      reasonCode: IMPORT_REASON_CODES.RESOLVER_GAP,
      pluginId: 'bazel-label',
      adapter: 'bazel-label',
      traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
      details
    };
  };

  return Object.freeze({
    id: 'bazel-label',
    priority: 10,
    fingerprint: 'v2',
    classify
  });
};
