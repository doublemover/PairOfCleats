import { isBazelLabelSpecifier } from '../../specifier-hints.js';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

export const createBazelLabelPlugin = () => {
  const classify = ({ spec = '', rawSpec = '' } = {}) => {
    const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
    if (!isBazelLabelSpecifier(targetSpecifier) && !isBazelLabelSpecifier(rawSpec)) return null;
    return {
      reasonCode: IMPORT_REASON_CODES.RESOLVER_GAP,
      pluginId: 'bazel-label',
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'bazel_label'
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
