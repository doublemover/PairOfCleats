import fs from 'node:fs/promises';
import { throwIfAborted } from '../../../../shared/abort.js';
import { createRuntimeObservation, markRuntimeCoverage, unknownFields, runtimeEventLimit } from './shared.js';

/** Inspector Profile version 1. JSON residence is explicitly bounded before parsing. */
export async function* adaptCpuProfile({ filename, artifact, capture, sourceCandidates, scriptHashes, coverage, signal }) {
  const allowance = Math.min(64 * 1024 * 1024, Math.floor(capture.limits.processTreeMemoryBytes / 12), capture.limits.maxBytes);
  if (artifact.byteLength > allowance) { markRuntimeCoverage(coverage, 'profile_resident_allowance_exceeded', 0, 'unsupported'); return; }
  throwIfAborted(signal);
  let profile;
  try { profile = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(filename))); }
  catch { markRuntimeCoverage(coverage, 'malformed_or_truncated_profile', 0, 'malformed'); return; }
  if (!profile || !Array.isArray(profile.nodes) || !Number.isFinite(profile.startTime)
    || !Number.isFinite(profile.endTime) || profile.startTime < 0 || profile.endTime < profile.startTime
    || (profile.samples !== undefined && !Array.isArray(profile.samples))
    || (profile.timeDeltas !== undefined && !Array.isArray(profile.timeDeltas))) {
    markRuntimeCoverage(coverage, 'invalid_profile_shape', 0, 'malformed'); return;
  }
  if (capture.clock.unit !== 'us') { markRuntimeCoverage(coverage, 'profile_clock_unit_mismatch', 0, 'unsupported'); return; }
  if (unknownFields(profile, ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas'])) markRuntimeCoverage(coverage, 'unknown_profile_fields');
  if ((profile.endTime - profile.startTime) / 1000 > capture.limits.durationMs) markRuntimeCoverage(coverage, 'profile_duration_exceeds_requested_window');
  const nodes = new Map(), parents = new Map(), counts = new Map(), durations = new Map();
  const nodeLimit = runtimeEventLimit(capture);
  for (const node of profile.nodes.slice(0, nodeLimit)) {
    throwIfAborted(signal);
    if (!node || !Number.isSafeInteger(node.id) || node.id < 0 || nodes.has(node.id)
      || !node.callFrame || typeof node.callFrame.functionName !== 'string'
      || typeof node.callFrame.scriptId !== 'string' || typeof node.callFrame.url !== 'string'
      || !Number.isSafeInteger(node.callFrame.lineNumber) || node.callFrame.lineNumber < -1
      || !Number.isSafeInteger(node.callFrame.columnNumber) || node.callFrame.columnNumber < -1
      || (node.children !== undefined && !Array.isArray(node.children))
      || (node.hitCount !== undefined && (!Number.isSafeInteger(node.hitCount) || node.hitCount < 0))) {
      markRuntimeCoverage(coverage, 'malformed_profile_node', 1); continue;
    }
    if (unknownFields(node, ['id', 'callFrame', 'hitCount', 'children', 'deoptReason', 'positionTicks'])
      || unknownFields(node.callFrame, ['functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber'])) markRuntimeCoverage(coverage, 'unknown_profile_node_fields');
    nodes.set(node.id, node);
  }
  if (profile.nodes.length > nodeLimit) markRuntimeCoverage(coverage, 'profile_node_limit', profile.nodes.length - nodeLimit);
  for (const node of nodes.values()) for (const child of node.children || []) {
    if (!Number.isSafeInteger(child) || !nodes.has(child) || parents.has(child) || child === node.id) {
      markRuntimeCoverage(coverage, 'invalid_or_ambiguous_profile_parent'); continue;
    }
    parents.set(child, node.id);
  }
  // Iterative topology validation avoids recursive stack growth and rejects cycles.
  const done = new Set();
  for (const id of nodes.keys()) {
    const visiting = new Set(); let cursor = id;
    while (parents.has(cursor) && !done.has(cursor)) {
      if (visiting.has(cursor)) { markRuntimeCoverage(coverage, 'cyclic_profile_tree', nodes.size, 'malformed'); return; }
      visiting.add(cursor); cursor = parents.get(cursor);
    }
    for (const visited of visiting) done.add(visited);
  }
  const samples = profile.samples || [], deltas = profile.timeDeltas || [];
  if (deltas.length && deltas.length !== samples.length) markRuntimeCoverage(coverage, 'sample_delta_length_mismatch');
  const sampleLimit = Math.min(capture.limits.maxSamples, samples.length);
  if (samples.length > sampleLimit) markRuntimeCoverage(coverage, 'profile_sample_limit', samples.length - sampleLimit);
  for (let index = 0; index < sampleLimit; index += 1) {
    throwIfAborted(signal);
    const id = samples[index];
    if (!nodes.has(id)) { markRuntimeCoverage(coverage, 'dangling_profile_sample', 1); continue; }
    counts.set(id, (counts.get(id) || 0) + 1);
    const delta = deltas[index];
    if (typeof delta === 'number' && Number.isFinite(delta) && delta >= 0
      && Number.isFinite((durations.get(id) || 0) + delta)) durations.set(id, (durations.get(id) || 0) + delta);
    else if (deltas.length) markRuntimeCoverage(coverage, 'invalid_profile_time_delta');
  }
  for (const node of nodes.values()) {
    throwIfAborted(signal);
    const frame = node.callFrame;
    const sourceHash = scriptHashes.get(frame.scriptId) || null;
    const data = { profileNodeId: node.id, parentNodeId: parents.get(node.id) ?? null,
      functionName: frame.functionName || '(anonymous)', scriptId: frame.scriptId || null, url: frame.url || null,
      lineNumber: frame.lineNumber < 0 ? null : frame.lineNumber, columnNumber: frame.columnNumber < 0 ? null : frame.columnNumber,
      coordinateConvention: 'inspector-zero-based-line-column', sampleCount: counts.get(node.id) || 0,
      duration: durations.has(node.id) ? durations.get(node.id) : null,
      deoptReason: typeof node.deoptReason === 'string' && node.deoptReason ? node.deoptReason : null };
    coverage.observedRecords += 1;
    yield createRuntimeObservation({ capture, artifact, kind: 'cpuProfile', data, sourceHash, sourceCandidates,
      identity: node.id, unavailable: [...(!sourceHash ? ['exact_source_hash'] : []), ...(!profile.samples ? ['samples'] : [])] });
  }
  if (!profile.samples) markRuntimeCoverage(coverage, 'profile_samples_unavailable');
}
