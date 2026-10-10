import { canonicalSemanticJson } from '../../identity.js';
import { assertRuntimeEvidence } from '../../../../contracts/validators/runtime-evidence.js';
import { readRuntimeLines, runtimeByteHash } from '../raw-store.js';
import { createRuntimeObservation, markRuntimeCoverage, unknownFields, runtimeEventLimit } from './shared.js';
import { OFFLINE_RUNTIME_ADAPTERS } from './inventory.js';

const supported = new Set(OFFLINE_RUNTIME_ADAPTERS.find(row => row.adapter === 'code-log').evidenceKinds);

/** Explicit saved interchange, not a guessed parser for unversioned engine diagnostics. */
export async function* adaptCodeLog({ filename, artifact, capture, sourceCandidates, coverage, signal }) {
  const maxLineBytes = Math.max(1, Math.min(1024 * 1024, Math.floor(capture.limits.processTreeMemoryBytes / 16)));
  let header = false, ordinal = 0;
  const lifetimes = new Map();
  const maps = new Map();
  for await (const line of readRuntimeLines({ filename, maxLineBytes, signal })) {
    if (!line.terminated) { markRuntimeCoverage(coverage, 'truncated_log_line', 1); continue; }
    if (line.oversized) { markRuntimeCoverage(coverage, 'log_line_allowance_exceeded', 1); continue; }
    let record;
    try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line.bytes)); }
    catch { markRuntimeCoverage(coverage, 'malformed_log_line', 1); continue; }
    if (!header) {
      if (record?.format !== 'pairofcleats-code-log' || record?.formatVersion !== '1'
        || unknownFields(record, ['format', 'formatVersion', 'scope', 'executableHash', 'workloadFingerprint', 'phase', 'clockDomain'])
        || canonicalSemanticJson(record.scope) !== canonicalSemanticJson(capture.scope)
        || record.executableHash !== capture.runtime.executableHash || record.workloadFingerprint !== capture.workload.fingerprint
        || record.phase !== capture.workload.phase || record.clockDomain !== capture.clock.domain) {
        markRuntimeCoverage(coverage, 'log_header_version_or_scope_mismatch', 0, 'unsupported'); return;
      }
      header = true; continue;
    }
    ordinal += 1;
    if (ordinal > runtimeEventLimit(capture)) { markRuntimeCoverage(coverage, 'log_event_limit', 1); continue; }
    if (!record || record.schemaVersion !== 1 || !supported.has(record.kind)
      || unknownFields(record, ['schemaVersion', 'kind', 'timestamp', 'sourceHash', 'data', 'listing'])
      || (record.sourceHash !== null && !/^[a-f0-9]{64}$/.test(record.sourceHash))) {
      markRuntimeCoverage(coverage, 'unknown_log_record_version_kind_or_fields', 1); continue;
    }
    if (record.kind === 'nativeDisassembly' && (typeof record.listing !== 'string'
      || runtimeByteHash(Buffer.from(record.listing)) !== record.data?.listingHash)) {
      markRuntimeCoverage(coverage, 'disassembly_listing_hash_mismatch', 1); continue;
    }
    if (record.kind !== 'nativeDisassembly' && record.listing !== undefined) {
      markRuntimeCoverage(coverage, 'unexpected_disassembly_listing', 1); continue;
    }
    let observation;
    try {
      observation = createRuntimeObservation({ capture, artifact, kind: record.kind, data: record.data,
        sourceHash: record.sourceHash, sourceCandidates, identity: ordinal,
        byteRange: { start: line.start, end: line.end }, timestamp: record.timestamp });
      assertRuntimeEvidence('evidence', observation);
      if (record.kind === 'scriptMetadata' && record.sourceHash !== record.data.contentHash) throw new Error('script hash');
      for (const key of [record.data.key, record.data.codeVersion, record.data.inlinedInto,
        record.data.map, record.data.previousMap, ...(record.data.feedbackMaps || []),
        ...(record.data.inlineFrames || []).map(frame => frame.codeVersion)].filter(Boolean)) {
        if (key.sessionId !== capture.scope.sessionId || key.processId !== capture.scope.processId) throw new Error('code scope');
        if (Object.values(key).some(value => value.length > 256)) throw new Error('code identity allowance');
      }
      if (record.data.scriptId && record.data.scriptId.length > 256) throw new Error('script identity allowance');
      for (const timestamp of [record.data.created, record.data.retired].filter(Boolean)) {
        if (timestamp.clockDomain !== capture.clock.domain) throw new Error('code clock');
      }
      if (record.data.created && record.data.retired && record.data.created.value > record.data.retired.value) throw new Error('code interval');
      if (record.data.architecture && record.data.architecture !== capture.runtime.architecture) throw new Error('code architecture');
      if (record.data.mapLifecycle && (record.kind !== 'mapEvent' || !record.data.map)) throw new Error('map lifecycle kind');
      if (record.data.detailRef) {
        const raw = capture.rawArtifacts.find(row => row.artifactId === record.data.detailRef.artifactId);
        if (!raw || raw.hash !== record.data.detailRef.hash || record.data.detailRef.byteRange?.end > raw.byteLength) throw new Error('feedback raw ref');
      }
    } catch { markRuntimeCoverage(coverage, 'malformed_or_cross_scope_log_record', 1); continue; }
    const codeRefs = [record.data.codeVersion, record.data.inlinedInto,
      ...(record.data.inlineFrames || []).map(frame => frame.codeVersion)].filter(Boolean);
    const at = record.timestamp?.value ?? null;
    const validLifetime = key => {
      const state = lifetimes.get(canonicalSemanticJson(key));
      return state && !state.retired && (at === null || ((state.created === null || at >= state.created)
        && (state.end === null || at <= state.end) && (state.last === null || at >= state.last)));
    };
    if (codeRefs.some(key => !validLifetime(key))) {
      markRuntimeCoverage(coverage, 'unresolved_or_retired_referenced_code_lifetime', 1); continue;
    }
    const mapRefs = [record.data.previousMap, ...(record.data.feedbackMaps || []),
      ...(record.data.map && record.data.mapLifecycle !== 'create' ? [record.data.map] : [])].filter(Boolean);
    if (mapRefs.some(key => maps.get(canonicalSemanticJson(key)) !== 'live')) {
      markRuntimeCoverage(coverage, 'unresolved_or_retired_map_lifetime', 1); continue;
    }
    const key = record.data.key;
    if (key) {
      const identity = canonicalSemanticJson(key);
      const state = lifetimes.get(identity);
      if (record.kind === 'codeVersion') {
        if (state) { markRuntimeCoverage(coverage, 'duplicate_code_lifetime', 1); continue; }
        if (at !== null && ((record.data.created && at < record.data.created.value)
          || (record.data.retired && at > record.data.retired.value))) {
          markRuntimeCoverage(coverage, 'code_creation_outside_lifetime', 1); continue;
        }
        lifetimes.set(identity, { retired: false, created: record.data.created?.value ?? at,
          end: record.data.retired?.value ?? null, last: at });
      } else if (!validLifetime(key)) {
        markRuntimeCoverage(coverage, 'unresolved_or_retired_code_lifetime', 1); continue;
      } else {
        if (at !== null) state.last = at;
        if (record.kind === 'codeLifecycle' && record.data.event === 'retire') state.retired = true;
      }
    }
    if (record.kind === 'mapEvent' && record.data.mapLifecycle) {
      const identity = canonicalSemanticJson(record.data.map);
      if (record.data.mapLifecycle === 'create' && maps.has(identity)) {
        markRuntimeCoverage(coverage, 'duplicate_map_lifetime', 1); continue;
      }
      maps.set(identity, record.data.mapLifecycle === 'retire' ? 'retired' : 'live');
    }
    if ((key || codeRefs.length) && at === null) observation.unavailable.push('Code event timestamp unavailable; event ordering alone does not prove clock alignment.');
    if (at !== null) {
      for (const reference of codeRefs) lifetimes.get(canonicalSemanticJson(reference)).last = at;
    }
    for (const frame of record.data.inlineFrames || []) {
      if (frame.sourceHash && !capture.sources.some(source => source.byteHash === frame.sourceHash)) {
        observation.unavailable.push('Inline frame source is outside the pinned capture inventory; no exact source join is asserted for it.');
        break;
      }
    }
    coverage.observedRecords += 1;
    yield observation;
  }
  if (!header) markRuntimeCoverage(coverage, 'missing_log_header', 0, 'malformed');
}
