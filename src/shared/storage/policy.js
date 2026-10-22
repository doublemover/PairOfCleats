const protectedRetention = new Set(['durable', 'evidence', 'mixed', 'referenced', 'unknown']);

/** Decisions compose category owners; they never recurse through a parent home. */
export const decideStorageLifecycle = (item, { includeEvidence = false, now = Date.now(), maxAgeMs = null } = {}) => {
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
  if (item.retention === 'downloadable' && item.explicitAssetEviction !== true) reasons.push('offline-critical-asset-retention');
  if (maxAgeMs !== null) {
    const lastUse = Date.parse(item.lastUse?.timestamp || '');
    if (!Number.isFinite(lastUse) || !item.lastUse?.provenance || item.lastUse.provenance === 'unknown') reasons.push('unknown-last-use');
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
  minimumFreeBytes = null, freeBytes = null, retainCount = 0, now = Date.now() } = {}) => {
  if (!Array.isArray(items)) throw new TypeError('Quota planning requires category-owner items.');
  softBytes = budgetValue(softBytes, 'softBytes');
  hardBytes = budgetValue(hardBytes, 'hardBytes');
  minimumFreeBytes = budgetValue(minimumFreeBytes, 'minimumFreeBytes');
  freeBytes = budgetValue(freeBytes, 'freeBytes');
  retainCount = budgetValue(retainCount, 'retainCount');
  if (retainCount === null) retainCount = 0;
  if (softBytes !== null && hardBytes !== null && softBytes > hardBytes) throw new TypeError('Soft storage budget exceeds hard budget.');
  const unique = new Map();
  let accountingComplete = inventoryComplete === true;
  for (const item of items) {
    if (item.complete !== true) accountingComplete = false;
    if (!item.physicalIdentity || !Number.isSafeInteger(item.allocatedBytes) || item.allocatedBytes < 0) {
      accountingComplete = false;
      continue;
    }
    const previous = unique.get(item.physicalIdentity);
    if (previous && previous.allocatedBytes !== item.allocatedBytes) accountingComplete = false;
    if (!previous) unique.set(item.physicalIdentity, { allocatedBytes: item.allocatedBytes, members: [] });
    unique.get(item.physicalIdentity).members.push(item);
  }
  const measuredExact = [...unique.values()].reduce((sum, entry) => sum + BigInt(entry.allocatedBytes), 0n);
  if (measuredExact > BigInt(Number.MAX_SAFE_INTEGER)) accountingComplete = false;
  const measuredBytes = measuredExact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(measuredExact) : null;
  const targetBudget = softBytes ?? hardBytes;
  const overSoft = targetBudget === null || measuredBytes === null ? 0 : Math.max(0, measuredBytes - targetBudget);
  const reserveNeed = minimumFreeBytes === null ? 0 : freeBytes === null ? null : Math.max(0, minimumFreeBytes - freeBytes);
  const target = Math.max(overSoft, reserveNeed || 0);
  const ordered = [...unique.entries()].map(([identity, entry]) => ({ identity, ...entry,
    decisions: entry.members.map(item => decideStorageLifecycle(item, { now })) }))
    .sort((a, b) => {
      const time = entry => Math.max(...entry.members.map(item => Date.parse(item.lastUse?.timestamp || '') || now));
      return time(a) - time(b) || a.identity.localeCompare(b.identity);
    });
  const eligible = ordered.filter(entry => entry.decisions.every(decision => decision.eligible));
  const retain = new Set(retainCount ? eligible.slice(-retainCount).map(entry => entry.identity) : []);
  const selected = [];
  let plannedBytes = 0;
  for (const entry of eligible) {
    if (!accountingComplete || reserveNeed === null) break;
    if (plannedBytes >= target || retain.has(entry.identity)) continue;
    // Every known alias must be selected by the category owner; a hardlink
    // outside inventory leaves reclaimability unknown rather than inflated.
    if (entry.members.some(item => item.allLinksAccounted !== true)) continue;
    selected.push(entry.identity);
    plannedBytes += entry.allocatedBytes;
  }
  const hardExceeded = hardBytes !== null && measuredBytes !== null && measuredBytes - plannedBytes > hardBytes;
  const unknown = !accountingComplete || reserveNeed === null;
  const satisfied = !unknown && !hardExceeded && plannedBytes >= target;
  return { schemaVersion: 1, accountingComplete, measuredUniqueAllocatedBytes: measuredBytes,
    requiredReclaimBytes: unknown ? null : target, plannedReclaimBytes: plannedBytes, selected,
    blocked: ordered.filter(entry => !entry.decisions.every(decision => decision.eligible))
      .map(entry => ({ physicalIdentity: entry.identity, reasons: [...new Set(entry.decisions.flatMap(decision => decision.reasons))] })),
    quotaSatisfied: satisfied, admission: unknown ? 'defer-accounting-required'
      : hardExceeded || !satisfied ? 'deny-space-needed' : plannedBytes > 0 ? 'defer-reviewed-cleanup-required' : 'admit',
    remedy: satisfied ? null : 'Release owned leases, retain evidence, adjust explicit budgets or provide more free space. No forced eviction.' };
};
