import { parseBazelLabelSpecifier } from '../../specifier-hints.js';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

export const createBazelLabelPlugin = () => {
  const classify = ({ spec = '', rawSpec = '', importerRel = '' } = {}) => {
    const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
    const parsed = parseBazelLabelSpecifier(targetSpecifier, { importerRel })
      || parseBazelLabelSpecifier(rawSpec, { importerRel });
    if (!parsed) return null;
    return {
      reasonCode: IMPORT_REASON_CODES.RESOLVER_GAP,
      pluginId: 'bazel-label',
      match: {
        matched: true,
        source: 'plugin',
        matchType: parsed.kind === 'external' ? 'bazel_external_label' : 'bazel_label',
        repo: parsed.repo || null
      }
    };
  };

  return Object.freeze({
    id: 'bazel-label',
    priority: 10,
    fingerprint: 'v1',
    classify
  });
};
