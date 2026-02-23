/**
 * Track bounded wait-time samples so queue picking can age tail-latency work.
 * Uses a fixed-size ring buffer once the sample cap is reached to avoid
 * repeated `Array#shift` compaction in long-lived schedulers.
 *
 * @param {{
 *   queue:{stats?:{lastWaitMs?:number,waitP95Ms?:number,waitSamples?:number[],waitSampleCursor?:number}},
 *   waitedMs:number,
 *   sampleLimit:number,
 *   resolvePercentile:(samples:number[],q:number)=>number
 * }} input
 * @returns {void}
 */
export const recordQueueWaitTimeSample = ({
  queue,
  waitedMs,
  sampleLimit,
  resolvePercentile
}) => {
  if (!queue?.stats) return;
  const normalized = Math.max(0, Math.floor(Number(waitedMs) || 0));
  queue.stats.lastWaitMs = normalized;
  const samples = Array.isArray(queue.stats.waitSamples)
    ? queue.stats.waitSamples
    : [];
  if (samples.length < sampleLimit) {
    samples.push(normalized);
    queue.stats.waitSampleCursor = samples.length % sampleLimit;
  } else if (samples.length > 0) {
    const cursorRaw = Number.isFinite(Number(queue.stats.waitSampleCursor))
      ? Math.floor(Number(queue.stats.waitSampleCursor))
      : 0;
    const cursor = ((cursorRaw % samples.length) + samples.length) % samples.length;
    samples[cursor] = normalized;
    queue.stats.waitSampleCursor = (cursor + 1) % samples.length;
  }
  queue.stats.waitSamples = samples;
  queue.stats.waitP95Ms = resolvePercentile(samples, 0.95);
};
