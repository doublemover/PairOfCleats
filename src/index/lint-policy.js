import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { stableStringifyForSignature } from '../shared/stable-json.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(stableStringifyForSignature(value));
const eslintVersion = createRequire(import.meta.url)('eslint/package.json').version;
export const LINT_PRODUCER = Object.freeze({ id: 'eslint-isolated', version: eslintVersion,
  node: process.versions.node, v8: process.versions.v8, policyVersion: '1' });
const rules = Object.freeze({ 'constructor-super': 2, 'no-dupe-args': 2, 'no-dupe-keys': 2,
  'no-this-before-super': 2, 'no-unreachable': 2, 'no-unsafe-finally': 2, 'valid-typeof': 2 });
const parser = Object.freeze({ ecmaVersion: 'latest', sourceType: 'module', jsx: true, commonjsExtension: '.cjs' });
const allowed = new Set(Object.keys(rules));

/** Internal built-in policies contain core severities only, never executable
 * config, parsers, processors, plugins, resolver paths or repository imports. */
export const createLintPolicy = (root, overrides = {}) => {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('Lint requires the absolute indexed root.');
  const selected = { ...rules };
  for (const [name, severity] of Object.entries(overrides)) {
    if (!allowed.has(name) || ![0, 1, 2].includes(severity)) throw new TypeError('Unsupported built-in lint policy.');
    selected[name] = severity;
  }
  const normalizedRoot = path.resolve(root), rootHash = hash(normalizedRoot);
  const identity = digest({ mode: 'isolated-builtin', rootHash, producer: LINT_PRODUCER, parser, rules: selected,
    configSearch: false, inlineConfig: false, ignore: false, fix: false });
  return Object.freeze({ schemaVersion: 1, mode: 'isolated-builtin', root: normalizedRoot, rootHash, identity,
    producer: LINT_PRODUCER, parser, rules: Object.freeze(selected) });
};

/** Re-admit plain worker projections by reconstructing the closed core policy. */
export const resolveLintPolicy = (root, supplied = null) => {
  const policy = createLintPolicy(root, supplied?.rules || {});
  if (supplied && stableStringifyForSignature(supplied) !== stableStringifyForSignature(policy)) {
    throw new TypeError('Lint policy does not match its indexed root, producer or effective configuration.');
  }
  return policy;
};

export const lintPolicyDependency = (root, supplied = null) => {
  try {
    const policy = resolveLintPolicy(root, supplied);
    return { mode: policy.mode, identity: policy.identity, rootHash: policy.rootHash, producer: policy.producer };
  } catch { return { mode: 'unavailable', reason: 'policy-admission-failed', producer: LINT_PRODUCER }; }
};

export const createLintSource = (text, relativePath, policy) => {
  if (typeof text !== 'string' || typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')
    || path.isAbsolute(relativePath)) throw new TypeError('Lint requires exact source text and a relative indexed path.');
  const filename = path.resolve(policy.root, relativePath), relative = path.relative(policy.root, filename);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new TypeError('Lint source is outside its indexed root.');
  }
  const bytes = Buffer.from(text);
  return { path: relative.split(path.sep).join('/'), hash: hash(bytes), byteLength: bytes.length };
};
export const lintCacheKey = (policy, source) => digest({ policy: policy.identity, source });

const durableStates = { completed: [null], unsupported: ['builtin-javascript-only', 'parser-rejected-source'],
  ignored: ['effective-policy-ignored'], disabled: ['heavy-file-downshift', 'parser-not-ast-full'] };
/** Stable negative policy outcomes can replay explicitly, never as clean arrays.
 * Runtime failures, missing policy and unqualified empty results cannot replay. */
export const isReusableLintOutcome = (receipt, policy, source = null) => {
  try { return Boolean(receipt?.schemaVersion === 1
  && durableStates[receipt.status]?.includes(receipt.reason) && receipt.policy?.identity === policy.identity
  && receipt.policy?.rootHash === policy.rootHash && digest(receipt.producer) === digest(policy.producer)
  && typeof receipt.source?.path === 'string' && /^[a-f0-9]{64}$/.test(receipt.source?.hash || '')
  && Number.isSafeInteger(receipt.source?.byteLength) && receipt.source.byteLength >= 0
  && receipt.diagnostics?.truncated === false && receipt.diagnostics?.omitted === 0
  && Number.isSafeInteger(receipt.diagnostics?.total) && receipt.diagnostics.total >= 0 && receipt.diagnostics.total <= 256
  && receipt.diagnostics.shown === receipt.diagnostics.total && !Object.hasOwn(receipt, 'failure')
  && receipt.clean === (receipt.status === 'completed' && receipt.diagnostics.total === 0)
  && (!source || stableStringifyForSignature(receipt.source) === stableStringifyForSignature(source))); }
  catch { return false; }
};
