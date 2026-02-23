import fsSync from 'node:fs';
import path from 'node:path';
import {
  getCurrentBuildInfo,
  resolveIndexRoot
} from '../../../shared/dict-utils.js';

const DEFAULT_MODE_ARTIFACT_SCAN_ORDER = Object.freeze([
  'code',
  'prose',
  'extracted-prose',
  'records'
]);

const CHUNK_META_CANDIDATE_FILES = Object.freeze([
  'chunk_meta.json',
  'chunk_meta.json.gz',
  'chunk_meta.json.zst',
  'chunk_meta.jsonl',
  'chunk_meta.jsonl.gz',
  'chunk_meta.jsonl.zst',
  'chunk_meta.meta.json',
  'chunk_meta.parts',
  'chunk_meta.columnar.json',
  'chunk_meta.binary-columnar.meta.json'
]);

/**
 * Normalize absolute path for stable equality checks.
 *
 * Windows paths are normalized case-insensitively to avoid false mismatches
 * when roots come from mixed casing sources (CLI args, current.json, stat IO).
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export const normalizeEmbeddingsPath = (value) => {
  if (!value) return null;
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

/**
 * Detect whether caller explicitly supplied `--index-root`.
 *
 * Explicit root semantics are strict: no auto-fallback to current/latest
 * builds is permitted, and missing artifacts should fail fast upstream.
 *
 * @param {Record<string, any>} parsedArgv
 * @param {string[]|unknown} rawArgs
 * @returns {boolean}
 */
const hasExplicitIndexRootArg = (parsedArgv, rawArgs) => {
  if (typeof parsedArgv?.['index-root'] === 'string' && parsedArgv['index-root'].trim()) return true;
  if (typeof parsedArgv?.indexRoot === 'string' && parsedArgv.indexRoot.trim()) return true;
  if (!Array.isArray(rawArgs) || !rawArgs.length) return false;
  return rawArgs.some((arg) => arg === '--index-root' || arg.startsWith('--index-root='));
};

/**
 * Create stage-3 index-root resolver for per-mode embeddings builds.
 *
 * Resolution order preserves existing behavior:
 * 1. Keep explicit `--index-root` pinned.
 * 2. For auto roots under repo cache, prefer current.json build roots first.
 * 3. Fall back to latest build root only when active root lacks artifacts.
 *
 * This sequencing prevents stale-root drift while still allowing auto mode to
 * recover when caller points at a cache container (`repoCache` or `builds`).
 *
 * @param {{
 *   argv:Record<string, any>,
 *   rawArgv:string[]|unknown,
 *   root:string,
 *   userConfig:object,
 *   indexRoot:string|null|undefined,
 *   modes:string[],
 *   repoCacheRootResolved:string,
 *   log?:(line:string)=>void,
 *   fsSyncImpl?:typeof fsSync,
 *   getCurrentBuildInfoImpl?:(root:string,userConfig:object,input:{mode:string|null})=>({buildRoot?:string|null,activeRoot?:string|null}|null),
 *   resolveIndexRootImpl?:(root:string,userConfig:object,input:{mode:string|null})=>string
 * }} input
 * @returns {{
 *   explicitIndexRoot:boolean,
 *   activeIndexRoot:string|null,
 *   hasModeArtifacts:(candidateRoot:string|null|undefined,mode?:string|null)=>boolean,
 *   resolveModeIndexRoot:(mode:string)=>string|null
 * }}
 */
export const createEmbeddingsIndexRootResolver = ({
  argv,
  rawArgv,
  root,
  userConfig,
  indexRoot,
  modes,
  repoCacheRootResolved,
  log = () => {},
  fsSyncImpl = fsSync,
  getCurrentBuildInfoImpl = getCurrentBuildInfo,
  resolveIndexRootImpl = resolveIndexRoot
}) => {
  const explicitIndexRoot = hasExplicitIndexRootArg(argv, rawArgv);
  let activeIndexRoot = indexRoot
    ? path.resolve(indexRoot)
    : resolveIndexRootImpl(root, userConfig, { mode: modes?.[0] || null });
  const primaryMode = typeof modes?.[0] === 'string' && modes[0] ? modes[0] : null;
  const repoCacheRootKey = normalizeEmbeddingsPath(repoCacheRootResolved);
  const buildsRootKey = normalizeEmbeddingsPath(path.join(repoCacheRootResolved, 'builds'));

  /**
   * Detect whether a root has stage2 artifacts for a mode.
   *
   * @param {string|null|undefined} candidateRoot
   * @param {string|null} [mode]
   * @returns {boolean}
   */
  const hasModeArtifacts = (candidateRoot, mode = null) => {
    if (!candidateRoot || !fsSyncImpl.existsSync(candidateRoot)) return false;
    const candidateModes = mode
      ? [mode]
      : (Array.isArray(modes) && modes.length ? modes : DEFAULT_MODE_ARTIFACT_SCAN_ORDER);
    for (const modeName of candidateModes) {
      if (typeof modeName !== 'string' || !modeName) continue;
      const indexDir = path.join(candidateRoot, `index-${modeName}`);
      if (!fsSyncImpl.existsSync(indexDir)) continue;
      if (fsSyncImpl.existsSync(path.join(indexDir, 'pieces', 'manifest.json'))) {
        return true;
      }
      for (const artifactName of CHUNK_META_CANDIDATE_FILES) {
        if (fsSyncImpl.existsSync(path.join(indexDir, artifactName))) {
          return true;
        }
      }
    }
    return false;
  };

  /**
   * Resolve most recently touched build root with artifacts for a mode.
   *
   * @param {string|null} [mode]
   * @returns {string|null}
   */
  const findLatestModeRoot = (mode = primaryMode) => {
    const buildsRoot = path.join(repoCacheRootResolved, 'builds');
    if (!fsSyncImpl.existsSync(buildsRoot)) return null;
    let entries = [];
    try {
      entries = fsSyncImpl.readdirSync(buildsRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const candidateRoot = path.join(buildsRoot, entry.name);
      if (!hasModeArtifacts(candidateRoot, mode)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = Number(fsSyncImpl.statSync(candidateRoot).mtimeMs) || 0;
      } catch {}
      candidates.push({ root: candidateRoot, mtimeMs });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.root || null;
  };

  /**
   * Resolve effective mode root with explicit-root pinning semantics.
   *
   * @param {string} mode
   * @returns {string|null}
   */
  const resolveModeIndexRoot = (mode) => {
    if (hasModeArtifacts(activeIndexRoot, mode)) return activeIndexRoot;
    if (explicitIndexRoot) return activeIndexRoot;
    const currentBuild = getCurrentBuildInfoImpl(root, userConfig, { mode });
    const currentRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
    if (currentRoot && hasModeArtifacts(currentRoot, mode)) return currentRoot;
    return findLatestModeRoot(mode) || activeIndexRoot;
  };

  if (activeIndexRoot && !explicitIndexRoot) {
    const activeRootKey = normalizeEmbeddingsPath(activeIndexRoot);
    const underRepoCache = activeRootKey
      && repoCacheRootKey
      && (activeRootKey === repoCacheRootKey || activeRootKey.startsWith(`${repoCacheRootKey}${path.sep}`));
    const needsCurrentBuildRoot = underRepoCache && (
      activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey
      || !hasModeArtifacts(activeIndexRoot, primaryMode)
    );
    if (needsCurrentBuildRoot) {
      const currentBuild = getCurrentBuildInfoImpl(root, userConfig, { mode: modes?.[0] || null });
      const buildRootCandidate = currentBuild?.buildRoot || null;
      const activeRootCandidate = currentBuild?.activeRoot || null;
      const promotedRoot = hasModeArtifacts(buildRootCandidate, primaryMode)
        ? buildRootCandidate
        : (hasModeArtifacts(activeRootCandidate, primaryMode) ? activeRootCandidate : null);
      const promotedRootKey = normalizeEmbeddingsPath(promotedRoot);
      if (promotedRoot && promotedRootKey && promotedRootKey !== activeRootKey) {
        activeIndexRoot = promotedRoot;
        log(`[embeddings] using active build root from current.json: ${activeIndexRoot}`);
      }
    }
  }

  if (!explicitIndexRoot && activeIndexRoot && !hasModeArtifacts(activeIndexRoot, primaryMode)) {
    const activeRootKey = normalizeEmbeddingsPath(activeIndexRoot);
    const allowLatestFallback = !activeRootKey
      || !fsSyncImpl.existsSync(activeIndexRoot)
      || activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey;
    if (allowLatestFallback) {
      const fallbackRoot = findLatestModeRoot(primaryMode);
      if (fallbackRoot && normalizeEmbeddingsPath(fallbackRoot) !== normalizeEmbeddingsPath(activeIndexRoot)) {
        activeIndexRoot = fallbackRoot;
        log(`[embeddings] index root lacked mode artifacts; using latest build root: ${activeIndexRoot}`);
      }
    }
  }

  return {
    explicitIndexRoot,
    activeIndexRoot,
    hasModeArtifacts,
    resolveModeIndexRoot
  };
};
