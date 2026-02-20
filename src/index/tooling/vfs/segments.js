import { toPosix } from '../../../shared/files.js';
import { computeSegmentUid } from '../../identity/chunk-uid.js';
import { normalizeLanguageId, resolveEffectiveExt } from './virtual-path.js';

/**
 * Resolve the effective language id for a chunk/segment.
 * @param {{chunk?:object,segment?:object,containerLanguageId?:string|null}} input
 * @returns {string}
 */
export const resolveEffectiveLanguageId = ({ chunk, segment, containerLanguageId }) => {
  const candidate = chunk?.lang
    || chunk?.metaV2?.lang
    || segment?.languageId
    || chunk?.containerLanguageId
    || containerLanguageId;
  return normalizeLanguageId(candidate, 'unknown');
};

const buildSegmentLookupKey = ({
  containerPath,
  segmentUid,
  segmentStart,
  segmentEnd,
  languageId,
  effectiveExt
}) => [
  containerPath || '',
  segmentUid || '',
  `${segmentStart}-${segmentEnd}`,
  languageId || '',
  effectiveExt || ''
].join('::');

const buildCoalesceGroupKey = ({
  containerPath,
  segmentStart,
  segmentEnd,
  languageId,
  effectiveExt
}) => [
  containerPath || '',
  `${segmentStart}-${segmentEnd}`,
  languageId || '',
  effectiveExt || ''
].join('::');

const buildSegmentDescriptor = ({
  chunk,
  containerPath,
  containerExt,
  containerLanguageId
}) => {
  const segment = chunk?.segment || null;
  if (!segment) return null;
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;
  const languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
  const effectiveExt = segment.ext || resolveEffectiveExt({ languageId, containerExt });
  return {
    containerPath,
    segmentUid: segment.segmentUid || null,
    segmentId: segment.segmentId || null,
    segmentType: segment.type || 'embedded',
    start: segment.start,
    end: segment.end,
    languageId,
    effectiveExt
  };
};

export const buildCoalescedSegmentMap = (chunks) => {
  const segmentsByContainer = new Map();
  const dedupe = new Set();
  for (const chunk of chunks || []) {
    if (!chunk?.file) continue;
    const containerPath = toPosix(chunk.file);
    const containerExt = chunk.ext || null;
    const containerLanguageId = chunk.containerLanguageId || null;
    const descriptor = buildSegmentDescriptor({
      chunk,
      containerPath,
      containerExt,
      containerLanguageId
    });
    if (!descriptor) continue;
    const key = buildSegmentLookupKey({
      containerPath,
      segmentUid: descriptor.segmentUid,
      segmentStart: descriptor.start,
      segmentEnd: descriptor.end,
      languageId: descriptor.languageId,
      effectiveExt: descriptor.effectiveExt
    });
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    if (!segmentsByContainer.has(containerPath)) segmentsByContainer.set(containerPath, []);
    segmentsByContainer.get(containerPath).push(descriptor);
  }
  const groupMap = new Map();
  for (const [containerPath, segments] of segmentsByContainer) {
    if (!Array.isArray(segments) || !segments.length) continue;
    segments.sort((a, b) => (a.start - b.start) || (a.end - b.end));
    let current = null;
    const flush = () => {
      if (!current) return;
      for (const seg of current.segments) {
        const key = buildSegmentLookupKey({
          containerPath,
          segmentUid: seg.segmentUid,
          segmentStart: seg.start,
          segmentEnd: seg.end,
          languageId: seg.languageId,
          effectiveExt: seg.effectiveExt
        });
        groupMap.set(key, current);
      }
      current = null;
    };
    for (const seg of segments) {
      if (!current) {
        current = {
          containerPath,
          start: seg.start,
          end: seg.end,
          languageId: seg.languageId,
          effectiveExt: seg.effectiveExt,
          segmentType: seg.segmentType,
          segments: [seg],
          segmentUid: seg.segmentUid || null,
          segmentId: seg.segmentId || null,
          key: buildCoalesceGroupKey({
            containerPath,
            segmentStart: seg.start,
            segmentEnd: seg.end,
            languageId: seg.languageId,
            effectiveExt: seg.effectiveExt
          }),
          coalesced: false,
          _segmentUidPromise: null
        };
        continue;
      }
      const canMerge = seg.start === current.end
        && seg.languageId === current.languageId
        && seg.effectiveExt === current.effectiveExt
        && seg.segmentType === current.segmentType;
      if (!canMerge) {
        flush();
        current = {
          containerPath,
          start: seg.start,
          end: seg.end,
          languageId: seg.languageId,
          effectiveExt: seg.effectiveExt,
          segmentType: seg.segmentType,
          segments: [seg],
          segmentUid: seg.segmentUid || null,
          segmentId: seg.segmentId || null,
          key: buildCoalesceGroupKey({
            containerPath,
            segmentStart: seg.start,
            segmentEnd: seg.end,
            languageId: seg.languageId,
            effectiveExt: seg.effectiveExt
          }),
          coalesced: false,
          _segmentUidPromise: null
        };
        continue;
      }
      current.segments.push(seg);
      current.end = seg.end;
      current.coalesced = current.segments.length > 1;
      current.segmentUid = current.coalesced ? null : current.segmentUid;
      current.segmentId = current.coalesced ? null : current.segmentId;
      current.key = buildCoalesceGroupKey({
        containerPath,
        segmentStart: current.start,
        segmentEnd: current.end,
        languageId: current.languageId,
        effectiveExt: current.effectiveExt
      });
    }
    flush();
  }
  return groupMap;
};

export const resolveSegmentLookupKey = ({
  containerPath,
  segmentUid,
  segmentStart,
  segmentEnd,
  languageId,
  effectiveExt
}) => buildSegmentLookupKey({
  containerPath,
  segmentUid,
  segmentStart,
  segmentEnd,
  languageId,
  effectiveExt
});

export const ensureCoalescedSegmentUid = async (group, fileText) => {
  if (!group) return null;
  if (group.segmentUid) return group.segmentUid;
  if (!group.coalesced) {
    group.segmentUid = group.segments?.[0]?.segmentUid || null;
    return group.segmentUid;
  }
  if (group._segmentUidPromise) return group._segmentUidPromise;
  group._segmentUidPromise = (async () => {
    const text = typeof fileText === 'string'
      ? fileText.slice(group.start, group.end)
      : '';
    const uid = await computeSegmentUid({
      segmentText: text,
      segmentType: 'coalesced',
      languageId: group.languageId
    });
    group.segmentUid = uid || group.segments?.[0]?.segmentUid || null;
    return group.segmentUid;
  })();
  return group._segmentUidPromise;
};
