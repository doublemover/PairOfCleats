import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { stableStringify } from '../../shared/stable-json.js';
import { TASK_SPAN_TRACE_VERSION } from '../../contracts/schemas/task-span-trace.js';
import { validateTaskSpanTrace } from '../../contracts/validators/task-span-trace.js';
import { snapshotEvaluationData, compareEvaluationKeys } from './plain-data.js';

export const TASK_SPAN_TRACE_POLICY = 'original-utf8-half-open.union-without-double-credit.v1;observable-attribution.v1;code-unit-order.v1';
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_TASK_SPAN_TRACE' });
const stages = ['retrieved', 'explored', 'delivered', 'used'];
const caps = { inputBytes: 4 * 1024 * 1024, outputBytes: 8 * 1024 * 1024, work: 1024 * 1024, maxMs: 500 };
export const taskTraceSourceKey = source => digest([source.repoId, source.mode, source.file, source.contentDigest]);

const union = spans => {
  const groups = new Map();
  for (const span of spans) {
    if (!groups.has(span.sourceKey)) groups.set(span.sourceKey, []);
    groups.get(span.sourceKey).push([span.start, span.end]);
  }
  return [...groups].sort(([a], [b]) => compareEvaluationKeys(a, b)).map(([sourceKey, ranges]) => {
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
    }
    return { sourceKey, ranges: merged };
  });
};
const bytes = rows => rows.reduce((sum, row) => sum + row.ranges.reduce((total, [start, end]) => total + end - start, 0), 0);
const intersection = (left, right) => {
  const other = new Map(right.map(row => [row.sourceKey, row.ranges])); let total = 0;
  for (const row of left) {
    const ranges = other.get(row.sourceKey) || []; let i = 0, j = 0;
    while (i < row.ranges.length && j < ranges.length) {
      const a = row.ranges[i], b = ranges[j]; total += Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
      if (a[1] <= b[1]) i++; else j++;
    }
  }
  return total;
};
const spanOrder = (a, b) => compareEvaluationKeys(a.sourceKey, b.sourceKey) || a.start - b.start || a.end - b.end;

/** Saved opt-in observations only. Source text is never read/captured and raw
 * labels never enter retrieval or selection. Used means explicit attribution. */
export const evaluateTaskSpanTrace = async (input, { signal = null, limits = {}, resumeKey = null } = {}) => {
  const started = performance.now(), budget = {};
  for (const [name, maximum] of Object.entries(caps)) {
    const value = limits[name] ?? maximum;
    if (!Number.isSafeInteger(value) || value < (name === 'outputBytes' ? 256 : 1) || value > maximum) throw fail(`Invalid tightened ${name} bound.`);
    budget[name] = value;
  }
  if (Object.keys(limits).some(name => !Object.hasOwn(caps, name))) throw fail('Unknown task-span trace bound.');
  let work = 0, traceKey = null;
  const stop = () => signal?.aborted ? 'cancelled' : performance.now() - started >= budget.maxMs ? 'deadline' : work > budget.work ? 'work' : null;
  const partial = reason => {
    const result = { schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'task-span-evaluation', complete: false, reason,
      traceKey, metrics: null, claims: null, decision: null };
    return Buffer.byteLength(JSON.stringify(result)) <= budget.outputBytes ? result : {
      schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'task-span-evaluation', complete: false, reason, metrics: null, claims: null, decision: null };
  };
  if (stop()) return partial(stop());
  const trace = snapshotEvaluationData(input, { maxBytes: caps.inputBytes, code: 'ERR_TASK_SPAN_TRACE' });
  const validation = validateTaskSpanTrace(trace);
  if (!validation.ok) throw fail(`Invalid task-span trace: ${validation.errors.slice(0, 4).join('; ')}`);
  if (Buffer.byteLength(JSON.stringify(trace)) > budget.inputBytes) return partial('input-bytes');
  trace.sources.sort((a, b) => compareEvaluationKeys(a.key, b.key)); trace.events.sort((a, b) => a.sequence - b.sequence);
  trace.claims.sort((a, b) => compareEvaluationKeys(a.id, b.id)); trace.gold.sort(spanOrder);
  traceKey = digest({ version: TASK_SPAN_TRACE_VERSION, policy: TASK_SPAN_TRACE_POLICY, trace });
  if (resumeKey !== null && resumeKey !== traceKey) throw fail('Trace checkpoint source, task, labels or event identity changed.');
  const sources = new Map(), files = new Set();
  for (const source of trace.sources) {
    if (++work % 128 === 0) await yieldImmediate();
    if (stop()) return partial(stop());
    const fileKey = stableStringify([source.repoId, source.mode, source.file]);
    if (source.key !== taskTraceSourceKey(source) || source.repoId !== trace.identity.repoId || source.generation !== trace.identity.generation
      || sources.has(source.key) || files.has(fileKey) || /[\\\u0000]/u.test(source.file) || source.file.startsWith('/')
      || /^[A-Za-z]:/u.test(source.file) || source.file.split('/').some(part => !part || part === '.' || part === '..')) throw fail('Source identity must be unique, repository-relative and pinned to the declared original generation.');
    sources.set(source.key, source); files.add(fileKey);
  }
  const spanError = span => {
    const source = sources.get(span.sourceKey);
    return !source ? 'source-unavailable' : span.generation !== trace.identity.generation ? 'wrong-generation'
      : span.start >= span.end || span.end > source.byteLength ? 'invalid-original-byte-range' : null;
  };
  for (const span of trace.gold) if (spanError(span)) throw fail('Gold spans require exact existing original-source byte identities.');
  const claimsById = new Map();
  for (const claim of trace.claims) {
    if (claimsById.has(claim.id) || (claim.judge.kind === 'unjudged' && (claim.label !== 'unknown' || claim.judge.identityKey !== null))
      || (claim.judge.kind !== 'unjudged' && claim.judge.identityKey === null)) throw fail('Atomic labels require unique claims and explicit independent judge identity; unjudged support stays unknown.');
    claimsById.set(claim.id, claim);
  }
  const raw = Object.fromEntries(stages.map(stage => [stage, []])), events = [], seenIds = new Set(), seenSequences = new Set();
  const completeStage = Object.fromEntries(stages.map(stage => [stage, trace.stages[stage] === 'complete']));
  for (const event of trace.events) {
    if (++work % 128 === 0) await yieldImmediate();
    if (stop()) return partial(stop());
    if (seenIds.has(event.id) || seenSequences.has(event.sequence)) throw fail('An event identity/sequence cannot be counted twice.');
    seenIds.add(event.id); seenSequences.add(event.sequence);
    let reason = event.sequence > trace.terminalSequence ? 'after-terminal' : null;
    if (!reason && event.status !== 'observed') {
      if (event.span !== null || event.attribution !== null || event.referenceId !== null) throw fail('Unknown/omitted observations cannot invent a mapped source span.');
      completeStage[event.stage] = false; reason = event.status;
    }
    if (!reason) {
      if (!event.span || ['unknown', 'omitted'].includes(trace.stages[event.stage])) throw fail('Observed spans require declared complete/partial stage instrumentation.');
      reason = spanError(event.span);
      if (event.stage === 'used') {
        if (!event.attribution || !event.referenceId) throw fail('Used evidence requires an observable claim or edit reference.');
        if (event.attribution === 'claim') {
          const claim = claimsById.get(event.referenceId);
          if (!claim) reason ||= 'claim-unavailable';
          else if (!claim.citations.some(span => span.sourceKey === event.span.sourceKey && span.generation === event.span.generation
            && span.start <= event.span.start && span.end >= event.span.end)) reason ||= 'attribution-span-not-cited';
        }
      } else if (event.attribution !== null || event.referenceId !== null) throw fail('Only used-stage observations declare claim/edit attribution.');
      if (!reason) raw[event.stage].push(event.span);
    }
    events.push({ id: event.id, sequence: event.sequence, stage: event.stage, accepted: !reason, reason });
  }
  const normalized = Object.fromEntries(stages.map(stage => [stage, union(raw[stage])])), gold = union(trace.gold), goldBytes = bytes(gold);
  work += trace.events.length + trace.gold.length;
  if (stop()) return partial(stop());
  const stageReports = Object.fromEntries(stages.map(stage => [stage, { instrumentation: trace.stages[stage], complete: completeStage[stage],
    observedBytes: bytes(normalized[stage]), goldOverlapBytes: intersection(normalized[stage], gold),
    acceptedEvents: events.filter(event => event.stage === stage && event.accepted).length,
    rejectedOrUnknownEvents: events.filter(event => event.stage === stage && !event.accepted).length }]));
  const claims = [];
  for (const claim of trace.claims) {
    if (++work % 128 === 0) await yieldImmediate();
    if (stop()) return partial(stop());
    const errors = claim.citations.map(span => spanError(span));
    const invalid = !claim.citations.length || errors.some(Boolean);
    work += claim.citations.length;
    claims.push({ id: claim.id, statementDigest: claim.statementDigest, rawLabel: claim.label, judge: claim.judge,
      deterministicValidity: invalid ? 'invalid' : 'valid', reasons: !claim.citations.length ? ['missing-citation'] : [...new Set(errors.filter(Boolean))],
      effectiveLabel: invalid ? 'invalid-citation' : claim.label,
      citations: claim.citations.map((span, index) => ({ ...span, valid: !errors[index],
        delivered: errors[index] || !completeStage.delivered ? null
          : intersection(union([span]), normalized.delivered) === span.end - span.start })) });
  }
  const observedRun = trace.status === 'complete', coverage = stage => observedRun && completeStage[stage] && goldBytes
    ? stageReports[stage].goldOverlapBytes / goldBytes : null;
  const deliveredBytes = stageReports.delivered.observedBytes;
  const metrics = observedRun ? { retrievalOverlap: coverage('retrieved'), exploredOverlap: coverage('explored'), deliveredCoverage: coverage('delivered'),
    claimedUtilization: completeStage.used && completeStage.delivered && deliveredBytes
      ? intersection(normalized.used, normalized.delivered) / deliveredBytes : null,
    atomicSupportRate: claims.length && claims.every(claim => claim.effectiveLabel !== 'unknown')
      ? claims.filter(claim => claim.effectiveLabel === 'supported').length / claims.length : null,
    taskSuccess: trace.outcome === 'unknown' ? null : trace.outcome === 'succeeded' ? 1 : 0 } : null;
  if (stop()) return partial(stop());
  const result = { schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'task-span-evaluation', complete: true,
    traceKey, policy: TASK_SPAN_TRACE_POLICY, judgmentPolicyKey: trace.judgmentPolicyKey,
    identity: trace.identity, runComplete: observedRun, runStatus: trace.status, outcome: trace.outcome,
    sourceDigest: digest(trace.sources.map(source => [source.key, source.byteLength])),
    goldDigest: digest(gold), stages: stageReports, events, normalized, gold, goldBytes, claims, metrics,
    trace, work: { units: work }, checkpoint: { key: traceKey, resume: 'restart-from-zero' }, decision: null,
    evidence: 'caller-pinned-metadata;source-bytes-and-human/model-labels-not-independently-revalidated;no-inferred-cognition' };
  return Buffer.byteLength(JSON.stringify(result)) > budget.outputBytes ? partial('output-bytes') : result;
};
