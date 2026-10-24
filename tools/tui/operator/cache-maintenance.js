import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { isUtf8 } from 'node:buffer';
import { loadUserConfig, getRepoCacheRoot, resolveSqlitePaths, resolveLmdbPaths } from '../../../src/shared/dict-utils.js';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { readCurrentBuildGeneration } from '../../../src/shared/indexing/build-generation.js';
import { sameIdentityPath } from '../../../src/shared/indexing/build-pointer-roots.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { prepareRepoCacheAccessHandoff, cancelRepoCacheAccessHandoff } from '../../../src/shared/cache/repo-access.js';
import { startDelegatedRepoCacheOwner } from '../../../src/shared/cache/repo-access-delegation.js';
import { killChildProcessTree } from '../../../src/shared/kill-tree.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

export const NATIVE_BACKEND_MAINTENANCE = new Set(['sqlite.compact', 'lmdb.build']);
const entries = { 'sqlite.compact': 'tools/build/compact-sqlite-index.js', 'lmdb.build': 'tools/build/lmdb-index.js' };
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const hasNodeOptions = env => Object.entries(env).some(([key, value]) => key.toUpperCase() === 'NODE_OPTIONS' && String(value || '').trim());
const fileIdentity = (root, target) => {
  assertNoSymlinkPath(root, target, { allowMissing: true });
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) fail('ERR_TUI_BACKEND_TARGET', 'Backend target must be an ordinary file or directory.');
    return { path: target, type: stat.isDirectory() ? 'directory' : 'file', dev: String(stat.dev), ino: String(stat.ino),
      size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
  } catch (error) { if (error.code === 'ENOENT') return { path: target, type: 'missing' }; throw error; }
};

/** Native bridge for the canonical authenticated child owner. Activation is a
 * code-owned integration decision after the canonical CLI finalizers exist.
 * An uncertain child close never resumes local cache admissions.
 */
export const createTuiCacheMaintenance = ({ toolRoot, requireScope, drainLocalReaders,
  delegationEnabled = false, env = process.env,
  prepareHandoff = prepareRepoCacheAccessHandoff, cancelHandoff = cancelRepoCacheAccessHandoff,
  startOwner = startDelegatedRepoCacheOwner, stopChild = killChildProcessTree } = {}) => {
  let state = null;
  const assertAdmission = () => {
    if (state?.blocked) fail(state.pending ? 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' : 'ERR_TUI_BACKEND_MAINTENANCE_ACTIVE',
      state.pending ? 'Backend ownership is unresolved; cache operations remain fenced.' : 'An exclusive backend maintenance owner is active.');
  };
  const status = () => state ? { scopeId: state.scopeId, commandId: state.commandId, jobId: state.jobId, resourceId: state.resourceId,
    phase: state.phase, blocked: state.blocked, pending: state.pending, root: state.root,
    ...(state.owner ? { child: state.owner.inspect() } : {}), ...(state.outcome ? { outcome: state.outcome } : {}) } : null;
  const prepare = async ({ scope, command, values, argv, signal }) => {
    requireScope(scope.id); assertAdmission(); throwIfAborted(signal);
    if (!delegationEnabled || typeof drainLocalReaders !== 'function') {
      fail('ERR_TUI_BACKEND_DELEGATION_UNAVAILABLE', 'Canonical child finalizers and the native reader-drain bridge must be enabled together.');
    }
    if (!NATIVE_BACKEND_MAINTENANCE.has(command.registryId) || scope.kind !== 'repo') {
      fail('ERR_TUI_BACKEND_COMMAND', 'Choose a canonical repository backend maintenance command.');
    }
    if (hasNodeOptions(env)) fail('ERR_TUI_BACKEND_NODE_OPTIONS', 'Delegated native ownership requires an environment without NODE_OPTIONS; no hook is silently removed.');
    if (values['as-of'] || values.snapshot) fail('ERR_TUI_BACKEND_GENERATION', 'This native adapter maintains the pinned current generation; historical/snapshot backend mutation remains CLI-only.');
    const mode = values.mode || 'all';
    if (!['all', 'code', 'prose'].includes(mode)) fail('ERR_TUI_BACKEND_MODE', 'Backend maintenance supports all, code or prose.');
    const config = loadUserConfig(scope.configRoot, { env });
    const backendConfig = command.registryId === 'sqlite.compact' ? config.sqlite || {} : config.lmdb || {};
    if (['dbDir', 'codeDbPath', 'proseDbPath', 'extractedProseDbPath', 'recordsDbPath']
      .some(key => backendConfig[key] != null && backendConfig[key] !== '')) {
      fail('ERR_TUI_BACKEND_TARGET', 'Native delegated maintenance requires canonical default backend paths; configured path overrides remain CLI-only.');
    }
    const root = getRepoCacheRoot(scope.configRoot, config);
    const buildsRoot = path.join(root, 'builds');
    const currentJsonPath = path.join(buildsRoot, 'current.json');
    const readGeneration = () => {
      const pointer = readVerifiedContainedFileSync(root, currentJsonPath, { maxBytes: 1024 * 1024 });
      const current = readCurrentBuildGeneration({ repoRoot: scope.configRoot, repoCacheRoot: root, buildsRoot, currentJsonPath });
      if (readVerifiedContainedFileSync(root, currentJsonPath, { maxBytes: 1024 * 1024 }).hash !== pointer.hash) {
        fail('ERR_TUI_BACKEND_STALE', 'Published generation pointer changed while being observed.');
      }
      return { ...current, pointerSha256: pointer.hash };
    };
    const generation = readGeneration();
    const selectedModes = mode === 'all' ? ['code', 'prose'] : [mode];
    const indexRoot = selectedModes.length === 1 ? generation.buildRoots?.[mode] || generation.buildRoot || generation.activeRoot
      : generation.buildRoot || generation.activeRoot;
    if (!generation.parseOk || !indexRoot) fail('ERR_TUI_BACKEND_GENERATION', 'Choose a repository with an existing published generation.');
    if (Object.keys(generation.buildRoots || {}).length && selectedModes.some(selected =>
      !generation.buildRoots[selected] || !sameIdentityPath(generation.buildRoots[selected], indexRoot))) {
      fail('ERR_TUI_BACKEND_GENERATION', 'Selected modes have different or missing published roots. Choose one published mode.');
    }
    if (!path.isAbsolute(indexRoot) || !isPathWithinRoot(indexRoot, root) || isPathWithinRoot(root, indexRoot)) {
      fail('ERR_TUI_BACKEND_GENERATION', 'Native delegated maintenance requires a published generation strictly inside the repository cache. Legacy cache-root generations remain CLI-only.');
    }
    assertNoSymlinkPath(root, indexRoot);
    const paths = command.registryId === 'sqlite.compact'
      ? resolveSqlitePaths(scope.configRoot, config, { indexRoot }) : resolveLmdbPaths(scope.configRoot, config, { indexRoot });
    const captureTarget = selected => {
      const target = selected === 'code' ? paths.codePath : paths.prosePath;
      if (!isPathWithinRoot(target, indexRoot) || isPathWithinRoot(indexRoot, target)) {
        fail('ERR_TUI_BACKEND_TARGET', 'Selected backend target must be strictly inside the reviewed generation.');
      }
      return { mode: selected, ...fileIdentity(root, target), related: command.registryId === 'sqlite.compact'
        ? ['-wal', '-shm', '-journal', '.bak'].map(suffix => fileIdentity(root, target + suffix))
        : ['data.mdb', 'lock.mdb'].map(name => fileIdentity(root, path.join(target, name))) };
    };
    const targets = selectedModes.map(captureTarget);
    if (command.registryId === 'sqlite.compact' && targets.every(target => target.type === 'missing')) {
      fail('ERR_TUI_BACKEND_TARGET', 'No selected SQLite database exists in this published generation.');
    }
    const entry = fs.realpathSync(path.join(toolRoot, entries[command.registryId]));
    const source = readVerifiedContainedFileSync(toolRoot, entry, { maxBytes: 1024 * 1024 });
    const args = [...argv.slice(command.commandPath.length), `--index-root=${indexRoot}`, '--progress=jsonl'];
    const commandIdentity = digest({ commandId: command.registryId, entry, sha256: source.hash, args });
    const review = { commandId: command.registryId, executionOwner: 'authenticated-canonical-cache-child',
      repoCacheRoot: root, generationKey: generation.generationKey, pointerSha256: generation.pointerSha256, indexRoot, targets,
      targetIdentityMeaning: 'Filesystem object/size/timestamp observation; no full database checksum or readiness claim.',
      entry, entrySha256: source.hash, arguments: args,
      effect: command.registryId === 'sqlite.compact' ? 'Copy/compact selected SQLite databases; dry-run and backup flags remain canonical.'
        : 'Build selected LMDB databases from this exact published generation and update canonical backend state.',
      drain: 'Other active jobs block admission. Search/source/artifact and semantic continuation resources are actually disposed before handoff; their volatile capabilities become stale.',
      exclusion: 'Default canonical repo-access coordination; exact parent lease drained, authenticated owned child admitted before command readers.',
      settlement: 'Only authenticated native handle/descendant closure plus actual child close resumes admission. Unknown settlement stays pending and fenced, including after cancellation.' };
    const execute = async context => {
      assertAdmission(); requireScope(scope.id); throwIfAborted(context.signal);
      if (hasNodeOptions(context.env || env)) fail('ERR_TUI_BACKEND_NODE_OPTIONS', 'Launch environment contains NODE_OPTIONS; delegated ownership is unavailable.');
      if (readVerifiedContainedFileSync(toolRoot, entry, { maxBytes: 1024 * 1024 }).hash !== source.hash
        || digest(selectedModes.map(captureTarget)) !== digest(targets)) {
        fail('ERR_TUI_BACKEND_STALE', 'Canonical maintenance entry or selected backend targets changed after preview.');
      }
      const current = readGeneration();
      if (current.generationKey !== generation.generationKey || current.pointerSha256 !== generation.pointerSha256) {
        fail('ERR_TUI_BACKEND_STALE', 'Published generation changed after preview.');
      }
      const owned = { scopeId: scope.id, commandId: command.registryId, jobId: context.jobId,
        resourceId: `tui-backend-${digest({ commandIdentity, jobId: context.jobId }).slice(0, 48)}`,
        root, phase: 'draining', pending: false, blocked: true, owner: null, outcome: null, kill: null };
      state = owned;
      let handoff = null;
      const confirmClosure = result => {
        if (result.protected || result.result?.settled !== true) return false;
        owned.outcome = result.result; owned.phase = 'settled'; owned.blocked = false;
        return true;
      };
      const stop = () => {
        if (!owned.owner || owned.owner.inspect().closed || owned.kill) return;
        // This is the exact ChildProcess created by the delegation owner. Never
        // discover or terminate a process from a status/PID label.
        owned.phase = 'cancelling';
        owned.kill = Promise.resolve(stopChild(owned.owner.child, { detached: false, graceMs: 1000 })).catch(() => null);
      };
      try {
        handoff = await prepareHandoff(root, { drain: input => drainLocalReaders({ ...input,
          jobId: context.jobId, launcherJob: context.launcherJob }) });
        throwIfAborted(context.signal);
        owned.phase = 'delegating';
        owned.owner = await startOwner(root, { localAccessHandoff: handoff, resourceId: owned.resourceId,
          commandIdentity, entry, args, cwd: scope.configRoot, env: context.env || env,
          coordinationRoot: null, stdio: ['ignore', 'pipe', 'pipe'] });
        context.onSpawn?.(owned.owner.child);
        const decoder = new StringDecoder('utf8');
        const stdout = [], maxBytes = 768 * 1024; let bytes = 0, truncated = false;
        owned.owner.child.stdout?.on('data', chunk => {
          context.onStdout?.(decoder.write(chunk));
          const remaining = Math.max(0, maxBytes - bytes);
          if (chunk.length > remaining) truncated = true;
          if (remaining) stdout.push(chunk.subarray(0, remaining));
          bytes += Math.min(chunk.length, remaining);
        });
        const stderr = new StringDecoder('utf8');
        owned.owner.child.stderr?.on('data', chunk => context.onStderr?.(stderr.write(chunk)));
        context.signal.addEventListener('abort', stop, { once: true });
        if (context.signal.aborted) stop();
        // startOwner returns the real spawned child before its asynchronous IPC
        // admission. Its inspect().admitted field, not spawn/PID, records that proof.
        owned.phase = context.signal.aborted ? 'cancelling' : 'child-started';
        context.onActivity?.({ stage: owned.phase,
          message: 'Owned backend child started; canonical protocol admission and closure remain independently observed.' });
        const result = await owned.owner.completion;
        context.onStdout?.(decoder.end()); context.onStderr?.(stderr.end());
        if (!confirmClosure(result)) {
          owned.pending = true; owned.phase = 'pending';
          fail('ERR_TUI_BACKEND_OWNERSHIP_PENDING', 'Canonical child closure did not settle ownership; cache operations remain fenced.');
        }
        const captured = Buffer.concat(stdout);
        return { exitCode: result.result.exitCode, signal: result.result.signal,
          stdout: captured.toString('utf8'),
          outputCapture: { stdout: { truncated, encodingLoss: !isUtf8(captured), bytes } } };
      } catch (error) {
        if (owned.owner && owned.outcome?.settled !== true) {
          if (!owned.owner.inspect().closed) stop();
          try {
            if (!confirmClosure(await owned.owner.completion)) owned.pending = true;
          } catch (closureError) { owned.pending = true; error = closureError; }
        }
        const pending = error.cacheOwnershipPending === true || owned.pending
          || owned.owner && owned.outcome?.settled !== true;
        if (pending) { owned.pending = true; owned.phase = 'pending'; owned.blocked = true;
          owned.outcome = { errorCode: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING', settled: false, pending: true }; }
        else {
          if (!owned.owner && handoff) cancelHandoff(handoff);
          owned.phase = owned.owner ? 'settled' : 'failed-before-owner'; owned.blocked = false;
        }
        if (pending && error.code !== 'ERR_TUI_BACKEND_OWNERSHIP_PENDING') {
          throw Object.assign(new Error('Backend ownership remains pending; cache admission is fenced.'),
            { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING', cacheOwnershipPending: true });
        }
        throw error;
      } finally {
        context.signal.removeEventListener('abort', stop);
        if (owned.kill) await owned.kill;
      }
    };
    return { review, execute };
  };
  return { prepare, status, assertAdmission, enabled: delegationEnabled && typeof drainLocalReaders === 'function',
    dispose: async () => {
      if (state?.owner && !state.owner.inspect().closed) {
        await stopChild(state.owner.child, { detached: false, graceMs: 1000 });
        try { await state.owner.completion; } catch { /* pending exclusion is retained by the canonical owner */ }
      }
    } };
};
