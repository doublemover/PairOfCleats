import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';

export const FUSION_DEPTH_POLICY = 'observed-ranked-prefix-or-owner-exhaustion.v1';
const fail = message => Object.assign(new Error(message), { code: 'ERR_FUSION_REPLAY' });
export const fusionChannelPrefixHash = keys => createHash('sha256').update(stableStringify(keys)).digest('hex');

export const captureFusionChannelCoverage = (channels, supplied = {}) => Object.fromEntries(
  ['sparse', 'dense'].map(channel => [channel, { ordering: 'ranked-prefix', capturedCount: channels[channel].length,
    requestedDepth: supplied?.[channel]?.requestedDepth ?? null, exhaustion: supplied?.[channel]?.exhaustion ?? null }])
);

export const validateFusionChannelCoverage = record => {
  const candidates = new Map(record.candidates.map(row => [row.idx, row.key]));
  for (const channel of ['sparse', 'dense']) {
    const coverage = record.channelCoverage[channel], count = record.channels[channel].length;
    if (coverage.capturedCount !== count || coverage.requestedDepth !== null
      && (!Number.isSafeInteger(coverage.requestedDepth) || coverage.requestedDepth < count || coverage.requestedDepth > 4096)) {
      throw fail('Fusion channel capture count or requested depth disagrees with its retained prefix.');
    }
    const witness = coverage.exhaustion;
    if (witness && (witness.state !== 'exhausted' || witness.basis !== 'capture-owner-complete-enumeration'
      || witness.eligibleCount !== count || witness.queryKey !== record.provenance.queryKey
      || witness.generation !== record.provenance.corpus.generation || witness.sourceDigest !== record.provenance.corpus.sourceDigest
      || witness.prefixHash !== fusionChannelPrefixHash(record.channels[channel].map(hit => candidates.get(hit.idx))))) {
      throw fail('Fusion channel exhaustion does not bind this query, corpus and ordered prefix.');
    }
  }
};

/** Metadata-only admission; unknown tails cannot stand in for deeper retrieval. */
export const fusionDepthAvailability = (record, candidate = {}) => Object.fromEntries(['sparse', 'dense'].map(channel => {
  const field = channel + 'Depth';
  const depth = Object.hasOwn(candidate, field) ? candidate[field] : record.channels[channel].length;
  const coverage = record.channelCoverage[channel];
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 4096) throw fail('Unsupported fusion replay candidate depth.');
  if (depth > coverage.capturedCount && !coverage.exhaustion) {
    throw fail(`Fusion ${channel} depth ${depth} exceeds captured prefix ${coverage.capturedCount} without exhausted-channel evidence.`);
  }
  return [channel, { requestedDepth: depth, effectiveDepth: Math.min(depth, coverage.capturedCount),
    capturedCount: coverage.capturedCount, captureRequestedDepth: coverage.requestedDepth,
    availability: depth <= coverage.capturedCount ? 'within-captured-prefix' : 'exhausted-channel',
    unseenTail: coverage.exhaustion ? 'proven-empty-by-capture-owner' : 'unknown' }];
}));
