// Atomic persistence is also used before application dependencies are installed.
// Keep its two closed counters independent of the optional metrics renderer.
const counts = { exdev: 0, unknown: 0 };
let metricObserver = null;
const reasonLabel = value => typeof value === 'string' && value.trim().toLowerCase() === 'exdev' ? 'exdev' : 'unknown';

export const getAtomicPersistenceFallbackCounts = () => Object.freeze(Object.entries(counts).map(([reason, count]) => Object.freeze({ reason, count })));

/** The existing metrics registry installs its one projection when loaded.
 * Restore only this actual callback; a later registry owner is not removed.
 */
export const setAtomicPersistenceMetricObserver = observer => {
  if (typeof observer !== 'function') throw new TypeError('Atomic persistence metrics require a synchronous observer.');
  const previous = metricObserver; metricObserver = observer;
  return () => { if (metricObserver === observer) metricObserver = previous; };
};

/** Preserve the current process event even before the Prometheus owner loads. */
export function incAtomicPersistenceFallback({ reason }) {
  const label = reasonLabel(reason); counts[label]++;
  metricObserver?.(label);
}
