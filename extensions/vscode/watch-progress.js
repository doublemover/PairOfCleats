/** Projection of docs/contracts/index-watch-progress.md. Watcher admission,
 * committed publication and search readiness remain different observations. */
function readWatchProgress(event, previous = null) {
  if (event?.proto !== 'poc.progress@2' || event.taskId !== 'watch:monitor' || event.stage !== 'watch'
    || !['task:start', 'task:progress', 'task:end'].includes(event.event)
    || !['starting', 'monitoring', 'updating', 'degraded', 'stopping', 'stopped'].includes(event.phase)
    || typeof event.ts !== 'string' || !Number.isFinite(Date.parse(event.ts))
    || typeof event.watchReady !== 'boolean' || event.readiness?.watcher !== event.watchReady
    || typeof event.publicationCommitted !== 'boolean'
    || event.readiness?.publishedGeneration !== event.publicationCommitted
    || event.readiness?.searchReady !== null || typeof event.quiescent !== 'boolean') return null;
  if (event.event !== 'task:end' && (typeof event.pendingReplay !== 'boolean'
    || !Number.isSafeInteger(event.backlogDepth) || event.backlogDepth < 0)) return null;
  if (event.phase === 'monitoring' && (event.state !== 'idle' || !event.watchReady || !event.quiescent
    || event.pendingReplay !== false || event.backlogDepth !== 0)) return null;
  if (['starting', 'degraded', 'stopping', 'stopped'].includes(event.phase) && event.watchReady) return null;
  if (event.phase === 'stopped' && (event.event !== 'task:end' || event.status === 'failed' || event.ownershipPending === true)) return null;
  if (event.event === 'task:end' && (!['failed', 'cancelled', 'done'].includes(event.status)
    || event.phase !== (event.status === 'failed' ? 'degraded' : 'stopped'))) return null;
  const generation = event.lastConsistentGeneration;
  const buildId = generation?.publicationCommitted === true && typeof generation.buildId === 'string'
    && generation.buildId.length > 0 && generation.buildId.length <= 256 ? generation.buildId : null;
  // task:end has no repeated generation object; preserve only a prior admitted
  // witness from this same owned task and only while publication remains true.
  const publishedBuildId = event.publicationCommitted ? buildId || (event.event === 'task:end' ? previous?.publishedBuildId || null : null) : null;
  return Object.freeze({ phase: event.phase === 'monitoring' ? 'idle-watch' : event.phase === 'updating' ? 'indexing' : event.phase,
    watcherReady: event.watchReady, publicationCommitted: event.publicationCommitted,
    publishedBuildId, searchReady: null, quiescent: event.quiescent,
    backlogDepth: event.event === 'task:end' ? null : event.backlogDepth,
    pendingReplay: event.event === 'task:end' ? null : event.pendingReplay,
    consistency: typeof event.consistency === 'string' ? event.consistency.slice(0, 128) : null,
    degradedReason: typeof event.degradedReason === 'string' ? event.degradedReason.slice(0, 256) : null,
    errorCode: typeof event.errorCode === 'string' ? event.errorCode.slice(0, 80) : null,
    ownershipPending: event.ownershipPending === true });
}

function describeWatchProgress(observation) {
  if (!observation) return [];
  return [`Canonical watch lifecycle: ${observation.phase}; owned process settlement is separate.`,
    `Watcher admission: ${observation.watcherReady ? 'observed' : 'not observed / degraded / stopping'}`,
    `Watch backlog: ${observation.backlogDepth ?? 'unknown'}; replay pending: ${observation.pendingReplay ?? 'unknown'}; quiescent: ${observation.quiescent}`,
    `Publication committed by this watch: ${observation.publicationCommitted}; generation: ${observation.publishedBuildId || 'unobserved'}`,
    'Search/backend readiness: unknown (watcher admission and publication do not qualify search).',
    ...(observation.degradedReason ? [`Watch degraded reason: ${observation.degradedReason}; code: ${observation.errorCode || 'unknown'}`] : []),
    ...(observation.ownershipPending ? ['Watch teardown ownership remains pending; this event does not release the owned process.'] : [])];
}

module.exports = { readWatchProgress, describeWatchProgress };
