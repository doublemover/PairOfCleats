import path from 'node:path';
import crypto from 'node:crypto';
import { readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveBenchSuite } from './suites/sweet16.js';
import { parseObservabilityContextEnv, buildChildObservability, applyObservabilityContextEnv } from '../../src/shared/observability.js';

export const BENCH_WORKLOAD_VERSION = 1;
export const BENCH_EXPERIMENT_VERSION = 1;
export const BENCH_REPORT_MAX_BYTES = 64 * 1024 * 1024;
export const benchmarkFingerprint = value => 'sha256:' + crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
export const substituteBenchTokens = (value, tokens) => {
  if (!tokens || typeof tokens !== 'object') return value;
  let out = String(value);
  for (const [key, replacement] of Object.entries(tokens)) out = out.split(`\${${key}}`).join(String(replacement ?? ''));
  return out;
};
const sourceIdentity = file => {
  try {
    const read = readVerifiedContainedFileSync(path.dirname(file), file, { maxBytes: 4 * 1024 * 1024 });
    return { state: 'observed', sha256: read.hash, bytes: read.buffer.length };
  } catch (error) {
    observeStorageResource(error, { phase: 'benchmark-entry-source' }).requireSettled();
    return { state: 'unavailable', reason: typeof error.code === 'string' ? error.code : 'source-read-failed' };
  }
};

/** Both runner and sweep resolve the existing suite through this one owner.
 * Entry source, resolved args and required/optional policy bind the same work.
 * Corpus/config coverage is independently supplied by each measured script. */
export const resolveBenchRunnerWorkload = ({ argv, root = process.cwd(), resolveSuite = resolveBenchSuite }) => {
  const suiteEntries = argv.suite ? resolveSuite(argv.suite) : null;
  const scripts = (Array.isArray(argv.scripts) ? argv.scripts : argv.scripts ? [argv.scripts] : [])
    .flatMap(value => String(value).split(',').map(part => part.trim()).filter(Boolean));
  const entries = scripts.length ? scripts.map(script => ({ id: path.basename(script), script, args: [] })) : suiteEntries || [];
  const tokens = { repoRoot: argv.repoRoot ? path.resolve(root, argv.repoRoot) : '',
    indexDir: argv.indexDir ? path.resolve(root, argv.indexDir) : '' };
  const observed = entries.map((entry, ordinal) => {
    const absScript = path.resolve(root, entry.script);
    return { ordinal, id: entry.id || path.basename(entry.script), absScript,
      args: Array.isArray(entry.args) ? entry.args.map(value => substituteBenchTokens(value, tokens)) : [],
      required: entry.allowSkip !== true,
      expect: Object.fromEntries(['json', 'baseline', 'current', 'delta'].filter(key => entry.expect?.[key] === true).map(key => [key, true])),
      source: sourceIdentity(absScript) };
  });
  const receipt = { version: BENCH_WORKLOAD_VERSION, suite: argv.suite || null, tokens,
    timeoutMs: argv.timeoutMs || 0, entries: observed,
    sourceScope: 'entry-bytes-and-resolved-command-contract' };
  return { entries, tokens, suiteMode: Boolean(suiteEntries), receipt: { ...receipt, fingerprint: benchmarkFingerprint(receipt) } };
};

export const reobserveBenchSources = workload => workload.entries.map(entry => {
  const observed = sourceIdentity(entry.absScript);
  return { ordinal: entry.ordinal, ...observed, state: entry.source.state !== 'observed' || observed.state !== 'observed' ? 'unavailable'
    : entry.source.sha256 === observed.sha256 && entry.source.bytes === observed.bytes ? 'unchanged' : 'changed' };
});

const validExperiment = value => value && value.version === BENCH_EXPERIMENT_VERSION
  && typeof value.experimentId === 'string' && /^[a-f0-9-]{36}$/u.test(value.experimentId)
  && typeof value.variantId === 'string' && /^variant-[0-9]{6}$/u.test(value.variantId)
  && /^sha256:[a-f0-9]{64}$/u.test(value.requestFingerprint || '')
  && /^sha256:[a-f0-9]{64}$/u.test(value.workloadFingerprint || '')
  && Number.isSafeInteger(value.maxReportBytes) && value.maxReportBytes >= 64 * 1024 && value.maxReportBytes <= BENCH_REPORT_MAX_BYTES;
export const readBenchmarkExperiment = (env = process.env) => {
  const value = parseObservabilityContextEnv(env)?.context?.benchmarkExperiment;
  if (!value) return null;
  if (!validExperiment(value)) throw new Error('Invalid benchmark experiment handoff.');
  return { version: value.version, experimentId: value.experimentId, variantId: value.variantId,
    requestFingerprint: value.requestFingerprint, workloadFingerprint: value.workloadFingerprint, maxReportBytes: value.maxReportBytes };
};
export const attachBenchmarkExperiment = (env, value) => {
  if (!validExperiment(value)) throw new Error('Invalid benchmark experiment handoff.');
  return applyObservabilityContextEnv(env, buildChildObservability(parseObservabilityContextEnv(env), {
    surface: 'bench', operation: 'ab-sweep', phase: 'variant', context: { benchmarkExperiment: value }
  }));
};
