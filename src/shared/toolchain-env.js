import path from 'node:path';
import { applyManagedGoEnvironment, isGoToolchainServer } from './managed-go.js';
import { applyManagedRubyEnvironment } from './managed-ruby.js';
import { planManagedChildStorage } from './storage/child-environment.js';
import { resolveStorageLayout } from './storage/layout.js';

const GRADLE_DAEMON_FLAG = '-Dorg.gradle.daemon=false';
const GRADLE_DAEMON_PATTERN = /-Dorg\.gradle\.daemon\s*=\s*\S+/i;

const normalizeEnv = (value) => (
  value && typeof value === 'object' ? { ...value } : {}
);

const resolveBeamCrashDumpPath = (env) => {
  const explicit = String(env?.ERL_CRASH_DUMP || '').trim();
  if (explicit) return explicit;
  return path.join(resolveStorageLayout({ env }).descriptors.tmp.path, 'toolchain', 'beam', 'erl_crash.dump');
};

const appendGradleDaemonFlag = (value) => {
  const base = typeof value === 'string' ? value.trim() : '';
  if (!base) return GRADLE_DAEMON_FLAG;
  if (GRADLE_DAEMON_PATTERN.test(base)) {
    return base.replace(GRADLE_DAEMON_PATTERN, GRADLE_DAEMON_FLAG).trim();
  }
  return `${base} ${GRADLE_DAEMON_FLAG}`.trim();
};

/**
 * Enforce daemon-off defaults for toolchains that spawn background workers.
 *
 * This is applied to long-running indexing/benchmark/test subprocess trees to
 * avoid lingering Gradle daemons after LSP workspace scans complete.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>|null|undefined} baseEnv
 * @param {{cwd?:string|null}} [options]
 * @returns {NodeJS.ProcessEnv}
 */
export const applyToolchainDaemonPolicyEnv = (baseEnv = null, options = {}) => {
  const routed = options.managedStorage
    ? planManagedChildStorage({ ...options.managedStorage, baseEnv: normalizeEnv(baseEnv), command: options.command,
      cwd: options.cwd || options.managedStorage.cwd || process.cwd() }).env
    : normalizeEnv(baseEnv);
  const next = applyManagedRubyEnvironment(routed, options);
  next.ORG_GRADLE_DAEMON = 'false';
  next.GRADLE_OPTS = appendGradleDaemonFlag(next.GRADLE_OPTS);
  const beamCrashDumpPath = resolveBeamCrashDumpPath(next);
  if (beamCrashDumpPath) {
    next.ERL_CRASH_DUMP = beamCrashDumpPath;
  }
  return isGoToolchainServer(options)
    ? applyManagedGoEnvironment(next, { toolingRoot: options?.toolingRoot || next.PAIROFCLEATS_TOOLING_DIR })
    : next;
};

/** Version and handshake probes must never provision a toolchain implicitly. */
export const resolveNoProvisionToolingEnvironment = (baseEnv, options = {}) => {
  const next = applyToolchainDaemonPolicyEnv(baseEnv, options);
  next.RUSTUP_AUTO_INSTALL = '0';
  const go = String(next.GOTOOLCHAIN || '').trim();
  if (!go || go === 'auto') next.GOTOOLCHAIN = 'path';
  else if (go === 'local+auto') next.GOTOOLCHAIN = 'local+path';
  else if (/^go[0-9][0-9A-Za-z.]*\+auto$/u.test(go)) next.GOTOOLCHAIN = go.replace(/\+auto$/u, '+path');
  else if (/^go[0-9][0-9A-Za-z.]*$/u.test(go)) next.GOTOOLCHAIN = `${go}+path`;
  return next;
};
