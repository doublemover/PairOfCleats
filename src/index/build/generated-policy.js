import path from 'node:path';
import ignore from 'ignore';
import { toPosix } from '../../shared/files.js';
import { MINIFIED_NAME_REGEX } from './watch/shared.js';

export const GENERATED_POLICY_REASON_CODE = 'USR-R-GENERATED-METADATA-ONLY';
export const GENERATED_POLICY_INDEX_MODE_METADATA_ONLY = 'metadata-only';

const GENERATED_POLICY_CLASSIFICATIONS = new Set(['generated', 'minified', 'vendor']);
const GENERATED_POLICY_SOURCES = new Set([
  'path-pattern',
  'filename-pattern',
  'content-heuristic',
  'explicit-policy'
]);
const EMPTY_PATTERNS = Object.freeze([]);
const DEFAULT_GENERATED_POLICY_CONFIG = Object.freeze({
  enabled: true,
  includePatterns: EMPTY_PATTERNS,
  excludePatterns: EMPTY_PATTERNS,
  includeCompiled: EMPTY_PATTERNS,
  excludeCompiled: EMPTY_PATTERNS
});

// These entries stay in SKIP_DIRS/SKIP_GLOBS so runtime ignore construction can
// remove them and route matching files through deterministic policy downgrades.
export const GENERATED_POLICY_DEFAULT_SKIP_DIRS = new Set([
  '__generated__',
  'generated',
  'gen'
]);

export const GENERATED_POLICY_DEFAULT_SKIP_GLOBS = new Set([
  '**/*.min.js',
  '**/*.min.mjs',
  '**/*.min.cjs',
  '**/*.min.css',
  '**/*.min.js.map',
  '**/*.min.css.map',
  '**/*.min.map',
  '**/*.bundle.js',
  '**/*.bundle.css',
  '**/*.bundle.js.map',
  '**/*.bundle.css.map',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
  '**/*.d.ts.map',
  '**/*.d.mts.map',
  '**/*.d.cts.map',
  '**/*.tsbuildinfo',
  '**/*.gen.ts',
  '**/*.gen.tsx',
  '**/*.g.ts',
  '**/*.g.tsx',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/*.generated.*',
  '**/*_generated.*',
  '**/*-generated.*',
  '**/*-min.js',
  '**/*-min.css'
]);

const VENDOR_PATH_PARTS = Object.freeze([
  '/vendor/',
  '/third_party/',
  '/thirdparty/',
  '/3rdparty/',
  '/external/',
  '/extern/'
]);

const GENERATED_PATH_PARTS = Object.freeze([
  '/__generated__/',
  '/generated/',
  '/gen/'
]);

const GENERATED_FILENAME_PATTERNS = Object.freeze([
  /\.generated\.[^/]+$/i,
  /(?:^|[_-])generated\.[^/]+$/i,
  /\.gen\.[^/]+$/i,
  /\.g\.[^/]+$/i,
  /\.bundle\.[^/]+$/i,
  /\.d\.(?:ts|mts|cts)(?:\.map)?$/i,
  /\.tsbuildinfo$/i
]);

const normalizePattern = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = toPosix(trimmed).replace(/^\/+/, '').replace(/^\.\//, '');
  return normalized || null;
};

const normalizePatternList = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const normalized = normalizePattern(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const compilePatternMatchers = (patterns) => (
  patterns.map((pattern) => {
    const matcher = ignore();
    matcher.add(pattern);
    return { pattern, matcher };
  })
);

const findMatchingPattern = (compiledPatterns, relPath) => {
  for (const entry of compiledPatterns) {
    if (entry.matcher.ignores(relPath)) return entry.pattern;
  }
  return null;
};

const normalizeRelPath = ({ relPath, absPath }) => {
  if (typeof relPath === 'string' && relPath.trim()) {
    return toPosix(relPath).replace(/^\/+/, '').replace(/^\.\//, '');
  }
  if (typeof absPath === 'string' && absPath.trim()) {
    return toPosix(absPath).replace(/^\/+/, '').replace(/^\.\//, '');
  }
  return '';
};

const normalizeBaseName = ({ baseName, relPath, absPath }) => {
  if (typeof baseName === 'string' && baseName.trim()) return baseName.trim();
  if (typeof relPath === 'string' && relPath.trim()) return path.basename(relPath);
  if (typeof absPath === 'string' && absPath.trim()) return path.basename(absPath);
  return '';
};

const classifyByPathOrName = ({ relPath, baseName }) => {
  const normalizedRel = String(relPath || '').toLowerCase();
  const boundedPath = `/${normalizedRel.replace(/^\/+|\/+$/g, '')}/`;
  const normalizedBase = String(baseName || '').toLowerCase();

  if (MINIFIED_NAME_REGEX.test(normalizedBase)) {
    return { classification: 'minified', source: 'filename-pattern' };
  }
  for (const part of VENDOR_PATH_PARTS) {
    if (boundedPath.includes(part)) {
      return { classification: 'vendor', source: 'path-pattern' };
    }
  }
  for (const part of GENERATED_PATH_PARTS) {
    if (boundedPath.includes(part)) {
      return { classification: 'generated', source: 'path-pattern' };
    }
  }
  for (const pattern of GENERATED_FILENAME_PATTERNS) {
    if (pattern.test(normalizedBase)) {
      return { classification: 'generated', source: 'filename-pattern' };
    }
  }
  return null;
};

const classifyByScanSkip = (scanSkip) => {
  if (!scanSkip || typeof scanSkip !== 'object') return null;
  if (scanSkip.reason !== 'minified') return null;
  const method = typeof scanSkip.method === 'string' ? scanSkip.method.trim().toLowerCase() : '';
  return {
    classification: 'minified',
    source: method === 'content' ? 'content-heuristic' : 'filename-pattern'
  };
};

const buildGeneratedPolicyBaseDecision = ({ relPath, baseName, scanSkip }) => {
  const byScan = classifyByScanSkip(scanSkip);
  if (byScan) return byScan;
  return classifyByPathOrName({ relPath, baseName });
};

/**
 * Build normalized generated/minified/vendor policy runtime configuration.
 *
 * @param {object} [indexingConfig]
 * @returns {{enabled:boolean,includePatterns:string[],excludePatterns:string[],includeCompiled:Array<object>,excludeCompiled:Array<object>}}
 */
export const buildGeneratedPolicyConfig = (indexingConfig = {}) => {
  const generatedPolicy = indexingConfig?.generatedPolicy;
  const rawPolicy = generatedPolicy && typeof generatedPolicy === 'object' ? generatedPolicy : {};
  const includePatterns = normalizePatternList(rawPolicy.include);
  const excludePatterns = normalizePatternList(rawPolicy.exclude);
  return {
    enabled: true,
    includePatterns,
    excludePatterns,
    includeCompiled: compilePatternMatchers(includePatterns),
    excludeCompiled: compilePatternMatchers(excludePatterns)
  };
};

/**
 * Resolve whether a file must be downgraded to metadata-only due to generated
 * policy defaults or explicit include/exclude overrides.
 *
 * Exclude patterns always win over include patterns.
 *
 * @param {object} input
 * @param {object|null} input.generatedPolicy
 * @param {string|null} [input.relPath]
 * @param {string|null} [input.absPath]
 * @param {string|null} [input.baseName]
 * @param {object|null} [input.scanSkip]
 * @returns {object|null}
 */
export const resolveGeneratedPolicyDecision = ({
  generatedPolicy,
  relPath = null,
  absPath = null,
  baseName = null,
  scanSkip = null
}) => {
  const policy = generatedPolicy && typeof generatedPolicy === 'object'
    ? generatedPolicy
    : DEFAULT_GENERATED_POLICY_CONFIG;
  const normalizedRelPath = normalizeRelPath({ relPath, absPath });
  if (!normalizedRelPath) return null;
  const normalizedBaseName = normalizeBaseName({ baseName, relPath: normalizedRelPath, absPath });
  const baseline = buildGeneratedPolicyBaseDecision({
    relPath: normalizedRelPath,
    baseName: normalizedBaseName,
    scanSkip
  });
  const matchedExclude = findMatchingPattern(policy.excludeCompiled || [], normalizedRelPath);
  if (matchedExclude) {
    return {
      downgrade: true,
      classification: baseline?.classification || 'generated',
      source: 'explicit-policy',
      indexMode: GENERATED_POLICY_INDEX_MODE_METADATA_ONLY,
      reasonCode: GENERATED_POLICY_REASON_CODE,
      policy: 'exclude',
      matchedPattern: matchedExclude
    };
  }
  const matchedInclude = findMatchingPattern(policy.includeCompiled || [], normalizedRelPath);
  if (matchedInclude) {
    return {
      downgrade: false,
      classification: baseline?.classification || null,
      source: 'explicit-policy',
      indexMode: 'full',
      reasonCode: null,
      policy: 'include',
      matchedPattern: matchedInclude
    };
  }
  if (!baseline) return null;
  return {
    downgrade: true,
    classification: baseline.classification,
    source: baseline.source,
    indexMode: GENERATED_POLICY_INDEX_MODE_METADATA_ONLY,
    reasonCode: GENERATED_POLICY_REASON_CODE,
    policy: 'default',
    matchedPattern: null
  };
};

/**
 * Emit deterministic downgrade metadata payload for skipped-file diagnostics.
 *
 * @param {object|null} decision
 * @returns {object|null}
 */
export const buildGeneratedPolicyDowngradePayload = (decision) => {
  if (!decision || decision.downgrade !== true) return null;
  const classification = GENERATED_POLICY_CLASSIFICATIONS.has(decision.classification)
    ? decision.classification
    : 'generated';
  const source = GENERATED_POLICY_SOURCES.has(decision.source)
    ? decision.source
    : 'explicit-policy';
  return {
    classification,
    source,
    indexMode: GENERATED_POLICY_INDEX_MODE_METADATA_ONLY,
    reasonCode: GENERATED_POLICY_REASON_CODE,
    policy: decision.policy || 'default',
    matchedPattern: decision.matchedPattern || null
  };
};
