import path from 'node:path';

const GRADLE_DAEMON_FLAG = '-Dorg.gradle.daemon=false';
const GRADLE_DAEMON_PATTERN = /-Dorg\.gradle\.daemon\s*=\s*\S+/i;

const normalizeEnv = (value) => (
  value && typeof value === 'object' ? { ...value } : {}
);

const resolveBeamCrashDumpPath = (env, cwd = null) => {
  const explicit = String(env?.ERL_CRASH_DUMP || '').trim();
  if (explicit) return explicit;
  const cacheRoot = String(env?.PAIROFCLEATS_CACHE_ROOT || '').trim();
  if (cacheRoot) return path.join(cacheRoot, 'erl_crash.dump');
  const workingDir = String(cwd || '').trim();
  if (workingDir) return path.join(workingDir, 'erl_crash.dump');
  return '';
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
  const next = normalizeEnv(baseEnv);
  next.ORG_GRADLE_DAEMON = 'false';
  next.GRADLE_OPTS = appendGradleDaemonFlag(next.GRADLE_OPTS);
  const beamCrashDumpPath = resolveBeamCrashDumpPath(next, options?.cwd || null);
  if (beamCrashDumpPath) {
    next.ERL_CRASH_DUMP = beamCrashDumpPath;
  }
  return next;
};
