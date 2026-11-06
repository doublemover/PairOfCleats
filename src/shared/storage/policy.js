const protectedRetention = new Set(['durable', 'evidence', 'mixed', 'referenced', 'unknown']);
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const timestamp = item => typeof item.lastUse?.timestamp === 'string' ? Date.parse(item.lastUse.timestamp) : NaN;
const checkTime = (now, maxAgeMs) => {
  if (!Number.isSafeInteger(now) || now < 0 || maxAgeMs !== null && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0)) {
    throw new TypeError('Storage lifecycle requires an exact nonnegative clock and retention age.');
  }
};

/** Decisions compose category owners; they never recurse through a parent home. */
export const decideStorageLifecycle = (item, { includeEvidence = false, now = Date.now(), maxAgeMs = null } = {}) => {
  checkTime(now, maxAgeMs);
  if (!item || typeof item !== 'object') throw new TypeError('Storage lifecycle requires a category-owner item.');
  const reasons = [];
  if (item.complete !== true) reasons.push('incomplete-accounting-or-reachability');
  if (item.ownerQualified !== true) reasons.push('category-owner-not-qualified');
  if (item.external === true) reasons.push('external-or-shared-user-storage');
  if (item.pinned === true || item.forensic === true) reasons.push('pinned-or-forensic');
  if (item.lease?.complete !== true || item.lease?.protected !== false) reasons.push('active-or-unknown-lease');
  if (item.references?.complete !== true || item.references?.retained !== false) reasons.push('retained-or-unknown-references');
  if (protectedRetention.has(item.retention || 'unknown')) {
    reasons.push(includeEvidence ? 'evidence-deletion-requires-dedicated-owner' : 'saved-or-referenced-evidence');
  }
  if (!protectedRetention.has(item.retention || 'unknown') && !['derived', 'temporary', 'downloadable'].includes(item.retention)) {
    reasons.push('unknown-retention-owner-required');
  }
  if (item.retention === 'downloadable' && item.explicitAssetEviction !== true) reasons.push('offline-critical-asset-retention');
  if (maxAgeMs !== null) {
    const lastUse = timestamp(item);
    if (!Number.isFinite(lastUse) || typeof item.lastUse?.provenance !== 'string' || !item.lastUse.provenance
      || item.lastUse.provenance === 'unknown') reasons.push('unknown-last-use');
    else if (now - lastUse < maxAgeMs) reasons.push('within-retention-age');
  }
  return { eligible: reasons.length === 0, reasons,
    impact: item.retention === 'derived' ? 'derived-cache-miss-and-rebuild'
      : item.retention === 'downloadable' ? 'redownload-and-offline-readiness-loss' : 'category-owner-required' };
};

const budgetValue = (value, key) => {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid storage ${key}.`);
  return value;
};

/** Pure quota/admission planning. Unknown allocation is never treated as zero. */
export const planStorageQuota = ({ items, inventoryComplete = false, softBytes = null, hardBytes = null,
  minimumFreeBytes = null, freeBytes = null, freeSpaceScopeId = null, retainCount = 0, maxAgeMs = null, now = Date.now() } = {}) => {
  if (!Array.isArray(items) || items.length > 100000) throw new TypeError('Quota planning requires at most 100000 category-owner items.');
  checkTime(now, maxAgeMs);
  if (freeSpaceScopeId !== null && (typeof freeSpaceScopeId !== 'string' || !freeSpaceScopeId.length || freeSpaceScopeId.length > 1024)) throw new TypeError('Invalid free-space allocation scope.');
  softBytes = budgetValue(softBytes, 'softBytes');
  hardBytes = budgetValue(hardBytes, 'hardBytes');
  minimumFreeBytes = budgetValue(minimumFreeBytes, 'minimumFreeBytes');
  freeBytes = budgetValue(freeBytes, 'freeBytes');
  retainCount = budgetValue(retainCount, 'retainCount');
  if (retainCount === null) retainCount = 0;
  if (softBytes !== null && hardBytes !== null && softBytes > hardBytes) throw new TypeError('Soft storage budget exceeds hard budget.');
  const unique = new Map(), unknownItems = [];
  let accountingComplete = inventoryComplete === true;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object') throw new TypeError('Quota items must be category-owner records.');
    if (item.complete !== true) accountingComplete = false;
    if (typeof item.physicalIdentity !== 'string' || !item.physicalIdentity.length || item.physicalIdentity.length > 1024
      || !Number.isSafeInteger(item.allocatedBytes) || item.allocatedBytes < 0) {
      accountingComplete = false;
      unknownItems.push({ index, reason: 'unknown-physical-identity-or-allocated-bytes' });
      continue;
    }
    const previous = unique.get(item.physicalIdentity);
    if (previous && previous.allocatedBytes !== item.allocatedBytes) { accountingComplete = false; previous.conflict = true; }
    if (!previous) unique.set(item.physicalIdentity, { allocatedBytes: item.allocatedBytes, members: [], conflict: false });
    unique.get(item.physicalIdentity).members.push(item);
  }
  const measuredExact = [...unique.values()].reduce((sum, entry) => sum + BigInt(entry.allocatedBytes), 0n);
  if (measuredExact > BigInt(Number.MAX_SAFE_INTEGER)) accountingComplete = false;
  const measuredBytes = measuredExact <= BigInt(Number.MAX_SAFE_INTEGER) && [...unique.values()].every(entry => !entry.conflict) ? Number(measuredExact) : null;
  const targetBudget = softBytes ?? hardBytes;
  const overSoft = targetBudget === null || measuredBytes === null ? 0 : Math.max(0, measuredBytes - targetBudget);
  let reserveNeed = minimumFreeBytes === null || minimumFreeBytes === 0 ? 0 : freeBytes === null ? null : Math.max(0, minimumFreeBytes - freeBytes);
  if (reserveNeed > 0 && freeSpaceScopeId === null) reserveNeed = null;
  const target = Math.max(overSoft, reserveNeed || 0);
  const ordered = [...unique.entries()].map(([identity, entry]) => {
    const scopes = new Set(entry.members.map(item => item.allocationScopeId));
    const qualifiedScopes = [...scopes].filter(scope => typeof scope === 'string' && scope.length && scope.length <= 1024);
    if (qualifiedScopes.length > 1) { accountingComplete = false; entry.scopeConflict = true; }
    const scope = scopes.size === 1 && qualifiedScopes.length === 1 ? qualifiedScopes[0] : null;
    return { identity, ...entry, scope, decisions: entry.members.map(item => decideStorageLifecycle(item, { now, maxAgeMs })) };
  })
    .sort((a, b) => {
      const time = entry => entry.members.reduce((latest, item) => { const parsed = timestamp(item); return Math.max(latest, Number.isFinite(parsed) ? parsed : now); }, -Infinity);
      return time(a) - time(b) || order(a.identity, b.identity);
    });
  const eligible = ordered.filter(entry => entry.decisions.every(decision => decision.eligible));
  const retain = new Set(retainCount ? eligible.slice(-retainCount).map(entry => entry.identity) : []);
  const selected = [];
  let plannedBytes = 0, plannedReserveBytes = 0;
  // Mandatory same-volume reserve work also reduces the global quota. Select
  // it first rather than evict unrelated-drive caches before paying that debt.
  const candidates = reserveNeed > 0 ? [...eligible.filter(entry => entry.scope === freeSpaceScopeId),
    ...eligible.filter(entry => entry.scope !== freeSpaceScopeId)] : eligible;
  for (const entry of candidates) {
    if (!accountingComplete || reserveNeed === null) break;
    if (retain.has(entry.identity) || entry.conflict) continue;
    const contributesReserve = freeSpaceScopeId !== null && entry.scope === freeSpaceScopeId;
    if (plannedBytes >= overSoft && (!contributesReserve || plannedReserveBytes >= reserveNeed)) continue;
    // Every known alias must be selected by the category owner; a hardlink
    // outside inventory leaves reclaimability unknown rather than inflated.
    if (entry.members.some(item => item.allLinksAccounted !== true)) continue;
    selected.push(entry.identity);
    plannedBytes += entry.allocatedBytes;
    if (contributesReserve) plannedReserveBytes += entry.allocatedBytes;
  }
  const hardExceeded = hardBytes !== null && measuredBytes !== null && measuredBytes - plannedBytes > hardBytes;
  const unknownReserveScope = reserveNeed > plannedReserveBytes && ordered.some(entry => entry.scope === null);
  const unknown = !accountingComplete || reserveNeed === null || unknownReserveScope;
  const satisfied = !unknown && !hardExceeded && plannedBytes >= overSoft && plannedReserveBytes >= reserveNeed;
  const blocked = ordered.map(entry => {
    const reasons = [...new Set(entry.decisions.flatMap(decision => decision.reasons))];
    if (entry.conflict) reasons.push('conflicting-allocation-evidence');
    if (entry.scopeConflict) reasons.push('conflicting-allocation-scope');
    if (retain.has(entry.identity)) reasons.push('retained-by-count-policy');
    if (entry.members.some(item => item.allLinksAccounted !== true)) reasons.push('unaccounted-file-links');
    return { physicalIdentity: entry.identity, reasons };
  }).filter(entry => entry.reasons.length);
  return { schemaVersion: 1, accountingComplete, measuredUniqueAllocatedBytes: measuredBytes,
    requiredReclaimBytes: unknown ? null : target, plannedReclaimBytes: plannedBytes, selected,
    unknownItems, blocked, requiredReserveReclaimBytes: reserveNeed, plannedReserveReclaimBytes: plannedReserveBytes,
    freeSpaceScopeId, reserveBlocked: reserveNeed > 0 ? ordered.filter(entry => entry.scope !== freeSpaceScopeId)
      .map(entry => ({ physicalIdentity: entry.identity, reason: entry.scope === null ? 'unqualified-allocation-scope' : 'different-free-space-scope' })) : [],
    reserveObservation: reserveNeed === null ? 'unknown-free-space-or-allocation-scope' : unknownReserveScope
      ? 'unqualified-object-allocation-scope' : reserveNeed > 0 ? 'scoped-reserve-required' : 'no-reserve-debt',
    quotaSatisfied: satisfied, admission: unknown ? 'defer-accounting-required'
      : hardExceeded || !satisfied ? 'deny-space-needed' : plannedBytes > 0 ? 'defer-reviewed-cleanup-required' : 'admit',
    remedy: satisfied ? null : 'Release owned leases, retain evidence, adjust explicit budgets or provide more free space. No forced eviction.' };
};
