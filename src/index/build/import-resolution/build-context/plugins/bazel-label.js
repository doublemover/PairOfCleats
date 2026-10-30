import { IMPORT_REASON_CODES } from '../../reason-codes.js';
import { IMPORT_RESOLUTION_TRACE_STAGES } from '../../trace-model.js';
import { createBazelPackageIndex } from '../../bazel-label.js';

export const createBazelLabelPlugin = ({ entries = [], bazelLabels = null } = {}) => {
  const index = bazelLabels || createBazelPackageIndex({ entries });
  const classify = ({ spec = '', rawSpec = '', importerRel = '' } = {}) => {
    const selected = index.classify(rawSpec || spec, { importerRel });
    if (selected.state === 'not-label') return null;
    const reasonCode = selected.repositoryMapping !== 'local'
      ? IMPORT_REASON_CODES.BAZEL_EXTERNAL_REPOSITORY_UNAVAILABLE
      : selected.state === 'package-missing' ? IMPORT_REASON_CODES.BAZEL_LABEL_PACKAGE_MISSING
        : ['target-missing', 'target-package-mismatch'].includes(selected.state) ? IMPORT_REASON_CODES.BAZEL_LABEL_TARGET_MISSING
          : IMPORT_REASON_CODES.RESOLVER_GAP;
    return { reasonCode, pluginId: 'bazel-label', adapter: 'bazel-label',
      traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
      details: { labelKind: selected.kind || null, labelState: selected.state, labelReason: selected.reason || null,
        repo: selected.repo || null, repositoryMapping: selected.repositoryMapping || 'local', targetScope: selected.targetScope || null,
        packageRel: selected.packageRel ?? selected.package ?? '', targetRel: selected.targetRel ?? selected.target ?? '',
        targetOrigin: selected.targetOrigin || null, labelRole: selected.labelRole || null,
        candidatePaths: selected.candidates || [], packageExists: selected.packageExists ?? null,
        targetExists: selected.targetExists ?? null, packageWitnesses: selected.packageWitnesses || [] } };
  };
  return Object.freeze({ id: 'bazel-label', priority: 10, fingerprint: 'v3:' + index.fingerprint, classify });
};
