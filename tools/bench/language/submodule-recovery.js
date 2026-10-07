import fs from 'node:fs';
import path from 'node:path';
import { classifyRepoPreflightBlock } from './repo-preflight-contracts.js';
import { assertNoSymlinkPath, openContainedFileSync } from '../../../src/shared/contained-file.js';

const MAX_METADATA_BYTES = 256 * 1024;
const MAX_MODULES = 4096;
const MAX_DEPTH = 32;
const MIN_GIT_TIMEOUT_MS = 100; // The existing synchronous command runner's minimum.
const normalizePath = (value) => process.platform === 'win32'
  ? path.resolve(value).toLowerCase() : path.resolve(value);
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const safeDetail = (value) => String(value || 'command failed')
  .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu, '$1[redacted]@')
  .replace(/([?&](?:token|access_token|auth|key|password)=)[^\s&#]+/giu, '$1[redacted]')
  .replace(/[\r\n]+/gu, ' | ').slice(0, 1024);
const validRelative = (value) => value && !/[\x00-\x1f\x7f]/u.test(value)
  && !/^(?:[A-Za-z]:|[/\\])/u.test(value)
  && !value.replace(/\\/gu, '/').split('/').some((part) => part === '..' || part === '.git');

export const readRepoSubmoduleMetadata = (root, metadata) => {
  const fd = openContainedFileSync(root, metadata);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) throw new Error('Submodule metadata exceeds its bounded regular-file limit.');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Submodule metadata changed during discovery.');
    return buffer.subarray(0, offset).toString('utf8');
  } finally { fs.closeSync(fd); }
};

/** Persist checkout coverage separately from indexing/provider results. */
export const summarizeRepoCheckout = (summary) => {
  if (!summary?.gitRepo) return null;
  const modules = summary.submodules || {};
  return {
    state: summary.preflight?.state || 'unknown',
    policy: summary.preflight?.submodulePolicy || 'strict-required',
    partialReady: summary.preflight?.partialReady === true,
    discoveryComplete: summary.preflight?.discoveryComplete !== false,
    detected: modules.detected || 0,
    missingPaths: [...(modules.requiredMissingPaths || []), ...(modules.optionalMissingPaths || [])],
    dirtyPaths: [...(modules.requiredDirtyPaths || []), ...(modules.optionalDirtyPaths || [])],
    warnings: (modules.warnings || []).map((warning) => ({
      path: warning.path, reason: warning.reason, code: warning.code ?? null,
      detail: safeDetail(warning.detail)
    }))
  };
};

/** Recover independent modules without running repository scripts or bypassing Git authentication. */
export const recoverRepoSubmodules = ({
  repoPath, runGit, timeoutMs = 120000, onLog = () => {}, now = () => performance.now()
}) => {
  const started = Number(now());
  const configured = Number(timeoutMs);
  const budgetMs = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 120000;
  const result = { ok: true, partialReady: false, discoveryComplete: true, updated: false,
    rewriteGithubSshToHttps: false, entries: [], warnings: [], fatal: null };
  const warn = (modulePath, reason, detail, code = null) => {
    result.partialReady = true;
    const warning = { path: modulePath || '.', reason, detail: safeDetail(detail), code };
    result.warnings.push(warning);
    onLog(`[repo-preflight] submodule ${JSON.stringify(warning.path)} unavailable (${reason}): ${warning.detail}; continuing with available repository files.`, 'warn');
    return warning;
  };
  const fatal = (modulePath, reason, detail, code = null) => {
    result.ok = false;
    result.discoveryComplete = false;
    result.fatal = { path: modulePath || '.', reason, detail: safeDetail(detail), code };
    return result;
  };
  let root;
  try { root = fs.realpathSync(repoPath); }
  catch { return fatal('.', 'repo-path-unavailable', 'Repository root is not available.'); }
  const remaining = () => Math.floor(budgetMs - (Number(now()) - started));
  const command = (cwd, args, options = {}) => {
    const availableMs = remaining();
    if (!(availableMs >= MIN_GIT_TIMEOUT_MS)) return { ok: false, status: null, timedOut: true, budgetExhausted: true, stderr: 'Shared submodule preflight budget exhausted.' };
    try {
      assertNoSymlinkPath(root, cwd);
      assertNoSymlinkPath(root, path.join(cwd, '.gitmodules'));
      const separator = args.indexOf('--');
      if (separator >= 0 && args[separator + 1]) {
        assertNoSymlinkPath(root, path.resolve(cwd, args[separator + 1]), { allowMissing: true });
      }
    }
    catch { return { ok: false, status: null, unsafe: true, stderr: 'Submodule working directory is no longer contained.' }; }
    return runGit(cwd, args, { ...options, timeoutMs: availableMs });
  };
  const interrupted = (response) => response?.timedOut !== true && (
    response?.cancelled || response?.signal || [130, 143].includes(response?.status)
    || (Number.isFinite(response?.status) && response.status < 0)
  );
  const reasonFor = (response) => {
    const detail = response?.stderr || response?.stdout || 'command failed';
    if (/repository not found|not our ref|couldn't find remote ref|does not appear to be a git repository/iu.test(detail)) return 'repository-unavailable';
    return classifyRepoPreflightBlock({ detail, timedOut: response?.timedOut === true }).blockedClass;
  };
  const statusFor = (cwd, relative) => {
    const response = command(cwd, ['-c', 'core.quotePath=false', 'submodule', 'status', '--', relative]);
    if (!response.ok) return { response, entry: null };
    for (const line of String(response.stdout || '').split(/\r?\n/u)) {
      const match = line.trim().match(/^([-+U]?)([0-9a-f]{7,64})\s+(.+)$/iu);
      if (!match || (match[3] !== relative && !match[3].startsWith(`${relative} (`))) continue;
      return { response, entry: { marker: match[1] || ' ', sha: match[2],
        missing: match[1] === '-', dirty: match[1] === '+' || match[1] === 'U' } };
    }
    return { response, entry: null };
  };
  const containedTarget = (cwd, relative) => {
    const target = path.resolve(cwd, relative);
    if (!inside(root, target) || target === cwd) return null;
    try { assertNoSymlinkPath(root, target, { allowMissing: true }); }
    catch { return null; }
    return target;
  };
  const contexts = [{ cwd: root, prefix: '', depth: 0 }];
  const seen = new Set();
  for (let cursor = 0; cursor < contexts.length; cursor += 1) {
    const { cwd, prefix, depth } = contexts[cursor];
    if (depth > MAX_DEPTH || result.entries.length >= MAX_MODULES || remaining() < MIN_GIT_TIMEOUT_MS) {
      result.discoveryComplete = false;
      warn(prefix, remaining() >= MIN_GIT_TIMEOUT_MS ? 'discovery-limit' : 'timeout', 'Further nested submodule discovery was not attempted.');
      continue;
    }
    let physical;
    try { physical = fs.realpathSync(cwd); }
    catch { result.discoveryComplete = false; warn(prefix, 'incomplete', 'Parent submodule checkout is not available.'); continue; }
    if (!inside(root, physical)) return fatal(prefix, 'unsafe-path', 'Submodule checkout escapes the repository root.');
    if (seen.has(normalizePath(physical))) continue;
    seen.add(normalizePath(physical));
    const metadata = path.join(physical, '.gitmodules');
    let stat;
    try { stat = fs.lstatSync(metadata); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      result.discoveryComplete = false; warn(prefix, 'metadata-unavailable', error?.message); continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_BYTES) {
      return fatal(prefix, 'unsafe-metadata', 'Submodule metadata must be a bounded regular file.');
    }
    let raw;
    try { raw = readRepoSubmoduleMetadata(root, metadata); }
    catch (error) { return fatal(prefix, 'unsafe-metadata', error.message); }
    const topLevel = command(physical, ['rev-parse', '--show-toplevel']);
    if (topLevel.unsafe) return fatal(prefix, 'unsafe-path', topLevel.stderr);
    if (interrupted(topLevel)) return fatal(prefix, 'interrupted', 'Submodule preflight was interrupted.', topLevel.status);
    if (!topLevel.ok || normalizePath(String(topLevel.stdout || '').trim()) !== normalizePath(physical)) {
      if (!prefix) return fatal(prefix, 'repo-root-invalid', topLevel.stderr || 'Repository root could not be verified.', topLevel.status);
      result.discoveryComplete = false; warn(prefix, reasonFor(topLevel), topLevel.stderr || 'Parent checkout could not be verified.', topLevel.status); continue;
    }
    // Parse the verified descriptor snapshot, rather than reopening a mutable
    // pathname inside Git. Include directives never resolve external files.
    const paths = command(physical, ['config', '--null', '--no-includes', '--file', '-', '--get-regexp', '^submodule\\..*\\.path$'], { input: raw });
    if (paths.unsafe) return fatal(prefix, 'unsafe-path', paths.stderr);
    if (interrupted(paths)) return fatal(prefix, 'interrupted', 'Submodule discovery was interrupted.', paths.status);
    if (!paths.ok && !(paths.status === 1 && !paths.stdout)) {
      if (!prefix && !paths.timedOut) return fatal(prefix, 'metadata-invalid', paths.stderr || 'Submodule declarations could not be parsed.', paths.status);
      result.discoveryComplete = false; warn(prefix, reasonFor(paths), paths.stderr || 'Submodule declarations could not be read.', paths.status); continue;
    }
    const declared = [];
    for (const row of String(paths.stdout || '').split('\0')) {
      if (!row) continue;
      const separator = row.indexOf('\n');
      if (separator < 0) return fatal(prefix, 'metadata-invalid', 'Submodule path output is malformed.');
      const relative = row.slice(separator + 1);
      if (!validRelative(relative)) return fatal(prefix, 'unsafe-path', 'Submodule path must remain inside its parent repository.');
      if (!declared.includes(relative)) declared.push(relative);
    }
    const rewrite = /git@github\.com:/iu.test(raw);
    result.rewriteGithubSshToHttps ||= rewrite;
    for (const relative of declared) {
      const modulePath = prefix ? `${prefix}/${relative.replace(/\\/gu, '/')}` : relative.replace(/\\/gu, '/');
      const target = containedTarget(physical, relative);
      if (!target) return fatal(modulePath, 'unsafe-path', 'Submodule path escapes its parent checkout.');
      if (result.entries.length >= MAX_MODULES || remaining() < MIN_GIT_TIMEOUT_MS) {
        result.discoveryComplete = false;
        warn(modulePath, remaining() >= MIN_GIT_TIMEOUT_MS ? 'discovery-limit' : 'timeout', 'This declared submodule was not verified or initialized.');
        break;
      }
      const initial = statusFor(physical, relative);
      if (initial.response.unsafe) return fatal(modulePath, 'unsafe-path', initial.response.stderr);
      if (interrupted(initial.response)) return fatal(modulePath, 'interrupted', 'Submodule status was interrupted.', initial.response.status);
      let entry = initial.entry;
      let attempted = false;
      let update;
      if (!entry || entry.missing) {
        const sync = command(physical, ['submodule', 'sync', '--', relative]);
        if (sync.unsafe) return fatal(modulePath, 'unsafe-path', sync.stderr);
        if (interrupted(sync)) return fatal(modulePath, 'interrupted', 'Submodule synchronization was interrupted.', sync.status);
        if (!sync.ok) warn(modulePath, reasonFor(sync), sync.stderr || 'Submodule URL synchronization failed.', sync.status);
        const args = ['submodule', 'update', '--init', '--checkout', '--jobs', '1', '--', relative];
        if (rewrite) args.unshift('-c', 'url.https://github.com/.insteadOf=git@github.com:');
        update = command(physical, args);
        if (update.unsafe) return fatal(modulePath, 'unsafe-path', update.stderr);
        if (interrupted(update)) return fatal(modulePath, 'interrupted', 'Submodule initialization was interrupted.', update.status);
        attempted = !update.budgetExhausted;
        const verified = statusFor(physical, relative);
        if (verified.response.unsafe) return fatal(modulePath, 'unsafe-path', verified.response.stderr);
        if (interrupted(verified.response)) return fatal(modulePath, 'interrupted', 'Submodule verification was interrupted.', verified.response.status);
        entry = verified.entry;
        if (update.ok && entry && !entry.missing) result.updated = true;
      }
      const record = { path: modulePath, ...(entry || { marker: '-', sha: null, missing: true, dirty: false }),
        initialMissing: !initial.entry || initial.entry.missing, initialDirty: initial.entry?.dirty === true, attempted };
      result.entries.push(record);
      if (!entry || entry.missing) {
        const response = update && !update.ok ? update : initial.response;
        warn(modulePath, response?.ok ? 'incomplete' : reasonFor(response),
          response?.ok ? 'Submodule remains uninitialized after verification.' : response?.stderr || 'Submodule checkout is unavailable.', response?.status ?? null);
        continue;
      }
      if (entry.dirty) warn(modulePath, 'revision-mismatch', 'Existing checkout differs from its recorded gitlink; its local work was preserved.');
      contexts.push({ cwd: target, prefix: modulePath, depth: depth + 1 });
    }
  }
  return result;
};
