import fs from 'node:fs';
import path from 'node:path';
import { buildReadinessReceipt } from '../../setup/readiness.js';

/** A prerequisite phase owns preparation; it never records measured benchmark time. */
export const prepareBenchmarkPrerequisites = async ({
  executionPlans, lifecycle, checkPrerequisites, dryRun = false,
  autoInstall = true, strict = false, onLog = () => {}
}) => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const preparedRepos = new Map();
  for (const plan of executionPlans) {
    const { task, repoPath, repoLabel } = plan;
    if (preparedRepos.has(repoPath)) continue;
    onLog(`[prerequisites] preparing ${repoLabel}.`);
    const presence = dryRun ? { ok: true, planned: true }
      : await lifecycle.ensureRepoPresent({ task, repoPath, repoLabel });
    const workspace = presence.ok
      ? dryRun ? { ok: true, planned: true } : await lifecycle.prepareRepoWorkspace({ repoPath }) : null;
    let prerequisite = null;
    if (presence.ok && workspace?.ok) {
      try {
        prerequisite = dryRun
          ? { readiness: buildReadinessReceipt({ dryRun: true }), autoInstall, verificationLevel: 'planned' }
          : await checkPrerequisites({ plan, autoInstall, strict });
      } catch (error) {
        if (error.name === 'AbortError' || ['ABORT_ERR', 'SUBPROCESS_ABORTED'].includes(error.code)) throw error;
        prerequisite = { readiness: buildReadinessReceipt({ items: [{ id: 'prerequisite-check',
          required: true, state: 'failed', reason: String(error.message || error).slice(0, 4096), code: error.code || null }] }) };
      }
    }
    const preparation = {
      presence, workspace, prerequisite,
      physicalRoot: dryRun ? null : (() => {
        try {
          const stat = fs.statSync(repoPath);
          return { path: fs.realpathSync(repoPath), device: stat.dev, inode: stat.ino };
        } catch { return null; }
      })()
    };
    preparedRepos.set(repoPath, preparation);
    if (prerequisite?.readiness?.state === 'degraded' || prerequisite?.readiness?.state === 'blocked') {
      onLog(`[prerequisites] ${repoLabel}: ${prerequisite.readiness.state}; `
        + [...prerequisite.readiness.blockedIds, ...prerequisite.readiness.omittedIds].join(', '), 'warn');
    }
  }
  const campaignBlocked = strict && [...preparedRepos.values()].some((prepared) => prepared.prerequisite?.readiness?.state === 'blocked');
  return {
    preparedRepos,
    report: {
      schemaVersion: 1, startedAt, completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs, measured: false, autoInstall, strict, dryRun, campaignBlocked,
      repositories: [...preparedRepos].map(([repoPath, prepared]) => ({ repoPath, ...prepared }))
    }
  };
};

/** Cached preparation cannot admit a replaced/missing checkout. Runtime policy is checked again by providers. */
export const isPreparedBenchmarkRootCurrent = (repoPath, preparation) => {
  if (!preparation?.physicalRoot) return false;
  try {
    const stat = fs.statSync(repoPath);
    return path.resolve(fs.realpathSync(repoPath)) === path.resolve(preparation.physicalRoot.path)
      && stat.dev === preparation.physicalRoot.device && stat.ino === preparation.physicalRoot.inode;
  }
  catch { return false; }
};

/** Doctor checks retain distinctions between installation, protocol and workspace coverage. */
export const buildBenchmarkPrerequisiteReadiness = ({ assets = [], installation = null, doctor = null,
  requestedProviderIds = [], strict = false, dryRun = false } = {}) => {
  const items = assets.map((item) => ({ ...item, required: item.required === true }));
  for (const item of installation?.items || []) items.push({ ...item, id: `install:${item.id}`, required: strict });
  for (const id of requestedProviderIds) {
    const provider = doctor?.providers?.find((entry) => entry.id === id);
    const failures = (provider?.checks || []).filter((check) => check.status !== 'ok');
    const ready = provider?.available === true && provider?.enabled === true
      && provider?.status === 'ok' && !failures.length;
    items.push({ id: `provider:${id}`, required: strict,
      state: ready ? 'available-and-verified' : provider ? 'unverified' : 'missing',
      verificationLevel: ready ? provider.handshake?.ok === true
        ? provider.handshake.scope === 'installation-only' ? 'installation-protocol-and-workspace-checks' : 'initialize-and-workspace-checks'
        : 'runtime-and-workspace-checks' : null,
      reason: failures.map((check) => `${check.name}: ${check.message}`).join('; ') || (provider ? null : 'Provider was not checked.'),
      details: provider || null });
  }
  if (doctor?.identity?.chunkUid?.available === false) {
    items.push({ id: 'chunk-identity', required: true, state: 'missing', reason: 'No usable xxhash backend.' });
  }
  return buildReadinessReceipt({ items, dryRun });
};
