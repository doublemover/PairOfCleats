import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ESLint } from 'eslint';
import { throwIfAborted } from '../shared/abort.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { LINT_PRODUCER, resolveLintPolicy, createLintSource, lintCacheKey, isReusableLintOutcome } from './lint-policy.js';

const supported = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const MAX_MESSAGES = 256, MAX_MESSAGE_BYTES = 65536;
const projectFailure = error => {
  const output = { code: null, message: 'Lint operation failed.' };
  if (typeof error === 'string') { output.message = error.slice(0, 512); return output; }
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return output;
  for (const [key, limit] of [['code', 128], ['message', 512]]) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (typeof descriptor?.value === 'string') output[key] = descriptor.value.slice(0, limit);
      else if (descriptor?.get) output.inspectionUnavailable = true;
    } catch { output.inspectionUnavailable = true; }
  }
  return output;
};
const messageFields = ['ruleId', 'severity', 'fatal', 'message', 'line', 'column', 'endLine', 'endColumn', 'nodeType', 'messageId'];
const projectMessages = messages => {
  const output = []; let bytes = 0;
  for (const original of messages.slice(0, MAX_MESSAGES)) {
    const row = {};
    for (const key of messageFields) {
      const value = original[key];
      if (typeof value === 'string') row[key] = value.slice(0, key === 'message' ? 1024 : 128);
      else if (typeof value === 'boolean' || value === null || (typeof value === 'number' && Number.isSafeInteger(value))) row[key] = value;
    }
    const size = Buffer.byteLength(JSON.stringify(row));
    if (bytes + size > MAX_MESSAGE_BYTES) break;
    bytes += size; output.push(row);
  }
  return output;
};

/** ESLint owns no closeable session API. Bound live runtimes, evict only idle
 * entries and keep active lintText work owned until its actual settlement. */
export const createLintAnalyzer = ({ Eslint = ESLint, maxSessions = 8 } = {}) => {
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 64) throw new TypeError('Invalid lint session bound.');
  const sessions = new Map();
  return async (text, relativePath, { root, policy: supplied = null, signal = null, enabled = true, reason = null, cache = null } = {}) => {
    const started = performance.now();
    let policy = null, source = null, cacheKey = null, entry = null, admitted = false, errorPresent = false, originalError;
    const finish = (status, why, messages = [], original = [], error = originalError) => {
      const diagnostics = { total: original.length, shown: messages.length, omitted: original.length - messages.length,
        truncated: original.length !== messages.length || original.some((row, index) => index < messages.length
          && typeof row.message === 'string' && row.message.length > 1024),
        fatal: original.filter(row => row.fatal).length,
        errors: original.filter(row => row.severity === 2).length, warnings: original.filter(row => row.severity === 1).length };
      const receipt = { schemaVersion: 1, status, reason: why, source, producer: LINT_PRODUCER,
        policy: policy ? { mode: policy.mode, identity: policy.identity, rootHash: policy.rootHash } : null,
        clean: status === 'completed' && diagnostics.total === 0, diagnostics,
        ...(errorPresent ? { failure: projectFailure(error) } : {}) };
      if (cacheKey && cache && isReusableLintOutcome(receipt, policy, source)) cache.set(cacheKey, { receipt, messages });
      if (status !== 'canceled') check();
      return { receipt, messages, ...(errorPresent ? { error: originalError } : {}),
        cost: { elapsedMs: performance.now() - started } };
    };
    const check = () => {
      try { throwIfAborted(signal); }
      catch (error) {
        const outcome = finish('canceled', 'caller-canceled').receipt;
        throw addStorageFailureContext(error, { lintOutcome: outcome }, originalError, { secondaryPresent: errorPresent });
      }
    };
    check();
    try { policy = resolveLintPolicy(root, supplied); source = createLintSource(text, relativePath, policy); }
    catch (error) {
      errorPresent = true; originalError = error; check();
      return finish(enabled ? 'unavailable' : 'disabled', enabled ? 'policy-admission-failed' : reason || 'disabled', [], [], error);
    }
    if (!enabled) return finish('disabled', reason || 'disabled');
    try {
      cacheKey = lintCacheKey(policy, source);
      const cached = cache?.get(cacheKey);
      check();
      if (isReusableLintOutcome(cached?.receipt, policy, source) && Array.isArray(cached?.messages)
        && cached.messages.length === cached.receipt.diagnostics.shown) {
        return { receipt: cached.receipt, messages: cached.messages, cost: { elapsedMs: performance.now() - started, cacheHit: true } };
      }
      if (!supported.has(path.extname(source.path).toLowerCase())) return finish('unsupported', 'builtin-javascript-only');
      entry = sessions.get(policy.identity);
      if (entry?.invalid) return finish('unavailable', 'runtime-invalidation-pending');
      if (!entry) {
        if (sessions.size >= maxSessions) {
          const idle = [...sessions].find(([, value]) => value.active === 0);
          if (!idle) return finish('unavailable', 'runtime-capacity');
          sessions.delete(idle[0]);
        }
        let instance;
        try {
          instance = new Eslint({ cwd: policy.root, overrideConfigFile: true, allowInlineConfig: false,
            ignore: false, fix: false, cache: false, flags: [],
            overrideConfig: [{ files: ['**/*.{js,jsx,mjs,cjs}'], languageOptions: { ecmaVersion: 'latest',
              sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, rules: { ...policy.rules } },
            { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } }] });
        } catch (error) {
          errorPresent = true; originalError = error; check();
          return finish('unavailable', 'runtime-initialization-failed', [], [], error);
        }
        entry = { instance, active: 0, invalid: false }; sessions.set(policy.identity, entry);
      }
      sessions.delete(policy.identity); sessions.set(policy.identity, entry); entry.active++; admitted = true;
      check();
      const filename = path.resolve(policy.root, source.path);
      const ignored = await entry.instance.isPathIgnored(filename); check();
      if (ignored) return finish('ignored', 'effective-policy-ignored');
      const results = await entry.instance.lintText(text, { filePath: filename, warnIgnored: false }); check();
      if (!Array.isArray(results) || results.length > 1) throw new TypeError('Invalid whole-file lint result.');
      if (!results.length) return finish('ignored', 'no-lint-result');
      if (!Array.isArray(results[0].messages)) throw new TypeError('Invalid lint messages.');
      const original = results[0].messages, messages = projectMessages(original);
      return finish(original.some(row => row.fatal) ? 'unsupported' : 'completed',
        original.some(row => row.fatal) ? 'parser-rejected-source' : null, messages, original);
    } catch (error) {
      errorPresent = true; originalError = error;
      if (entry) entry.invalid = true;
      check(); return finish('failed', 'lint-execution-failed', [], [], error);
    } finally {
      if (entry && admitted) {
        entry.active--;
        if (entry.invalid && entry.active === 0 && sessions.get(policy.identity) === entry) sessions.delete(policy.identity);
      }
    }
  };
};

export const lintFile = createLintAnalyzer();
