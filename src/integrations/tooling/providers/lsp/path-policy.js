import path from 'node:path';
import {
  isDocsPath,
  isFixturePath,
  isInfraConfigPath
} from '../../../../index/build/mode-routing.js';
import { resolveGeneratedPolicyDecision } from '../../../../index/build/generated-policy.js';

const toPosixLower = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
const stripSegmentSuffix = (value) => String(value || '').split('#')[0];
const extensionOf = (virtualPath) => path.extname(stripSegmentSuffix(virtualPath)).toLowerCase();
const normalizeVirtualPath = (virtualPath) => stripSegmentSuffix(virtualPath)
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .replace(/^\.poc-vfs\/+/i, '')
  .replace(/^poc-vfs\/+/i, '');

const matchesAny = (text, patterns) => {
  for (const pattern of patterns || []) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
};

const GENERIC_LOW_VALUE_PATH_PATTERNS = Object.freeze([
  /\/examples?\//i,
  /\/samples?\//i,
  /\/tests?\//i,
  /\/testdata\//i,
  /\/bench(?:marks)?\//i,
  /\/scripts?\//i,
  /\/tools?\//i,
  /\/spec\//i
]);

const classifySharedPathSignals = (virtualPath) => {
  const normalizedRelPath = normalizeVirtualPath(virtualPath);
  const lowered = toPosixLower(normalizedRelPath);
  const bounded = lowered.startsWith('/') ? lowered : `/${lowered}`;
  const generatedDecision = resolveGeneratedPolicyDecision({
    generatedPolicy: null,
    relPath: normalizedRelPath,
    baseName: path.basename(normalizedRelPath)
  });
  const generatedLike = generatedDecision?.downgrade === true;
  return {
    normalizedRelPath,
    lowered,
    bounded,
    docsPath: isDocsPath(normalizedRelPath),
    fixturePath: isFixturePath(normalizedRelPath),
    infraPath: isInfraConfigPath(normalizedRelPath),
    generatedLike,
    lowValuePath: matchesAny(bounded, GENERIC_LOW_VALUE_PATH_PATTERNS)
  };
};

const PATH_POLICY_PROFILES = Object.freeze({
  pyright: Object.freeze({
    allowedExtensions: Object.freeze(['.py', '.pyi']),
    deprioritizePatterns: Object.freeze([
      /\/docs?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/tests?\//i,
      /\/testdata\//i,
      /\/bench(?:marks)?\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/vendor\//i,
      /\/third_party\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/docs?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/tests?\//i,
      /\/testdata\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/vendor\//i,
      /\/third_party\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/docs?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/tests?\//i,
      /\/testdata\//i
    ])
  }),
  gopls: Object.freeze({
    allowedExtensions: Object.freeze(['.go']),
    deprioritizePatterns: Object.freeze([
      /\/docs?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/tests?\//i,
      /\/testdata\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/bench(?:marks)?\//i,
      /\/vendor\//i,
      /\/third_party\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/docs?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/tests?\//i,
      /\/testdata\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/bench(?:marks)?\//i,
      /\/vendor\//i,
      /\/third_party\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/docs?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/tests?\//i,
      /\/testdata\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/bench(?:marks)?\//i,
      /\/vendor\//i
    ])
  }),
  clangd: Object.freeze({
    allowedExtensions: Object.freeze([
      '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm'
    ]),
    deprioritizePatterns: Object.freeze([
      /\/docs?\//i,
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/bench(?:marks)?\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/deps\//i,
      /\/vendor\//i,
      /\/third_party\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/docs?\//i,
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/bench(?:marks)?\//i,
      /\/scripts?\//i,
      /\/tools?\//i,
      /\/deps\//i,
      /\/vendor\//i,
      /\/third_party\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/docs?\//i,
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/bench(?:marks)?\//i,
      /\/scripts?\//i,
      /\/tools?\//i
    ])
  }),
  sourcekit: Object.freeze({
    allowedExtensions: Object.freeze(['.swift']),
    deprioritizePatterns: Object.freeze([
      /\/docs?\//i,
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/scripts?\//i,
      /\/tools?\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/docs?\//i,
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/scripts?\//i,
      /\/tools?\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/docs?\//i,
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i,
      /\/scripts?\//i,
      /\/tools?\//i
    ])
  }),
  'lua-language-server': Object.freeze({
    allowedExtensions: Object.freeze(['.lua']),
    deprioritizePatterns: Object.freeze([
      /\/tests?\//i,
      /\/spec\//i,
      /\/examples?\//i,
      /\/samples?\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/tests?\//i,
      /\/spec\//i,
      /\/examples?\//i,
      /\/samples?\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/tests?\//i,
      /\/spec\//i,
      /\/examples?\//i,
      /\/samples?\//i
    ])
  }),
  'rust-analyzer': Object.freeze({
    allowedExtensions: Object.freeze(['.rs']),
    deprioritizePatterns: Object.freeze([
      /\/tests?\//i,
      /\/examples?\//i,
      /\/benches\//i,
      /\/testdata\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/tests?\//i,
      /\/examples?\//i,
      /\/benches\//i,
      /\/testdata\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/tests?\//i,
      /\/examples?\//i,
      /\/benches\//i,
      /\/testdata\//i
    ])
  }),
  zls: Object.freeze({
    allowedExtensions: Object.freeze(['.zig']),
    deprioritizePatterns: Object.freeze([
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i
    ]),
    skipDocumentSymbolPatterns: Object.freeze([
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i
    ]),
    suppressInteractivePatterns: Object.freeze([
      /\/tests?\//i,
      /\/examples?\//i,
      /\/samples?\//i
    ])
  })
});

export const classifyLspDocumentPathPolicy = ({ providerId, virtualPath }) => {
  const normalizedProviderId = String(providerId || '').trim().toLowerCase();
  const profile = PATH_POLICY_PROFILES[normalizedProviderId] || null;
  const extension = extensionOf(virtualPath);
  if (!profile) {
    return {
      skipDocument: false,
      deprioritized: false,
      suppressInteractive: false,
      skipDocumentSymbol: false,
      selectionTier: 'preferred',
      extension
    };
  }
  const sharedSignals = classifySharedPathSignals(virtualPath);
  const normalizedPath = sharedSignals.bounded;
  const allowedExtensions = new Set(profile.allowedExtensions || []);
  const skipDocument = allowedExtensions.size > 0 && (!extension || !allowedExtensions.has(extension));
  const lowValueDocumentSymbol = !skipDocument && (
    sharedSignals.docsPath
    || sharedSignals.fixturePath
    || sharedSignals.lowValuePath
    || matchesAny(normalizedPath, profile.skipDocumentSymbolPatterns)
    || matchesAny(normalizedPath, profile.suppressInteractivePatterns)
  );
  const secondaryDocument = !skipDocument && !lowValueDocumentSymbol && (
    sharedSignals.docsPath
    || sharedSignals.infraPath
    || sharedSignals.generatedLike
    || matchesAny(normalizedPath, profile.deprioritizePatterns)
  );
  const selectionTier = skipDocument
    ? 'skipped'
    : (lowValueDocumentSymbol ? 'low-value' : (secondaryDocument ? 'secondary' : 'preferred'));
  const deprioritized = !skipDocument && (
    sharedSignals.docsPath
    || sharedSignals.fixturePath
    || sharedSignals.infraPath
    || sharedSignals.generatedLike
    || sharedSignals.lowValuePath
    || matchesAny(normalizedPath, profile.deprioritizePatterns)
  );
  const suppressInteractive = !skipDocument && (
    sharedSignals.docsPath
    || sharedSignals.fixturePath
    || sharedSignals.generatedLike
    || matchesAny(normalizedPath, profile.suppressInteractivePatterns)
  );
  return {
    skipDocument,
    deprioritized,
    suppressInteractive,
    skipDocumentSymbol: lowValueDocumentSymbol,
    selectionTier,
    extension
  };
};

export const __classifyLspDocumentPathPolicyForTests = classifyLspDocumentPathPolicy;

export const resolveLspStartupDocuments = ({
  providerId,
  documents,
  captureDiagnostics = false,
  targets = []
}) => {
  const sourceDocuments = Array.isArray(documents) ? documents : [];
  const targetPaths = !captureDiagnostics
    ? new Set(
      (Array.isArray(targets) ? targets : [])
        .map((target) => String(target?.virtualPath || ''))
        .filter(Boolean)
    )
    : null;
  const selected = [];
  let skippedByPathPolicy = 0;
  let skippedByDocumentSymbolPolicy = 0;
  let skippedByMissingTargets = 0;
  for (const doc of sourceDocuments) {
    const pathPolicy = classifyLspDocumentPathPolicy({
      providerId,
      virtualPath: doc?.virtualPath || ''
    });
    if (pathPolicy.skipDocument) {
      skippedByPathPolicy += 1;
      continue;
    }
    if (!captureDiagnostics && pathPolicy.skipDocumentSymbol) {
      skippedByDocumentSymbolPolicy += 1;
      continue;
    }
    if (!captureDiagnostics && targetPaths && !targetPaths.has(String(doc?.virtualPath || ''))) {
      skippedByMissingTargets += 1;
      continue;
    }
    selected.push(doc);
  }
  return {
    documents: selected,
    skippedByPathPolicy,
    skippedByDocumentSymbolPolicy,
    skippedByMissingTargets
  };
};
