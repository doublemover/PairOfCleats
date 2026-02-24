import path from 'node:path';

const QUICK_BAKEOFF_DEFAULTS = Object.freeze({
  limit: 20,
  embeddingSampleFiles: 50,
  embeddingSampleSeed: 'quick-smoke',
  skipCompare: true,
  resume: true
});

const FULL_RUN_BAKEOFF_DEFAULTS = Object.freeze({
  limit: 0,
  embeddingSampleFiles: 0,
  embeddingSampleSeed: 'full-run',
  skipCompare: false,
  resume: false
});

/**
 * Check whether a CLI option was provided explicitly in raw argv.
 *
 * @param {string[]} rawArgs
 * @param {string} optionName
 * @returns {boolean}
 */
const hasExplicitOption = (rawArgs, optionName) => {
  const option = `--${optionName}`;
  const noOption = `--no-${optionName}`;
  return rawArgs.some((entry) => (
    entry === option
    || entry === noOption
    || entry.startsWith(`${option}=`)
    || entry.startsWith(`${noOption}=`)
  ));
};

/**
 * Clamp values to non-negative integers.
 *
 * @param {number} value
 * @param {number} fallback
 * @returns {number}
 */
const toNonNegativeInteger = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
};

/**
 * Trim strings with a fallback.
 *
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
const toTrimmedString = (value, fallback) => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

/**
 * Resolve internal script paths used by embedding bakeoff runs.
 * @param {{repoRoot:string,toolRoot:string}} options
 * @returns {{buildIndexScript:string,evalScript:string,compareScript:string}}
 */
export function resolveBakeoffScriptPaths({ repoRoot, toolRoot }) {
  return {
    buildIndexScript: path.join(repoRoot, 'build_index.js'),
    evalScript: path.join(toolRoot, 'tools', 'eval', 'run.js'),
    compareScript: path.join(toolRoot, 'tools', 'reports', 'compare-models.js')
  };
}

/**
 * Resolve sqlite stage-4 behavior from CLI args.
 * @param {{rawArgs:string[],buildIndex:boolean,buildSqlite:boolean}} options
 * @returns {{buildSqliteExplicit:boolean,buildSqlite:boolean,runStage4OnlyBuild:boolean}}
 */
export function resolveBakeoffBuildPlan({ rawArgs, buildIndex, buildSqlite }) {
  const buildSqliteExplicit = rawArgs.some((entry) => (
    entry === '--build-sqlite' || entry.startsWith('--build-sqlite=')
  ));
  const sqliteStageRequested = buildSqliteExplicit && buildSqlite === true;
  return {
    buildSqliteExplicit,
    buildSqlite: sqliteStageRequested,
    runStage4OnlyBuild: sqliteStageRequested && !buildIndex
  };
}

/**
 * Resolve quick/full profile defaults while preserving explicit CLI overrides.
 *
 * Quick profile is the default when `--full-run` is not set.
 *
 * @param {{
 *  rawArgs:string[],
 *  fullRun:boolean,
 *  limit:number,
 *  embeddingSampleFiles:number,
 *  embeddingSampleSeed:string,
 *  skipCompare:boolean,
 *  resume:boolean
 * }} options
 * @returns {{
 *  profile:'quick'|'full',
 *  limit:number,
 *  embeddingSampleFiles:number,
 *  embeddingSampleSeed:string,
 *  skipCompare:boolean,
 *  resume:boolean
 * }}
 */
export function resolveBakeoffFastPathDefaults({
  rawArgs,
  fullRun,
  limit,
  embeddingSampleFiles,
  embeddingSampleSeed,
  skipCompare,
  resume
}) {
  const profile = fullRun ? 'full' : 'quick';
  const defaults = fullRun
    ? FULL_RUN_BAKEOFF_DEFAULTS
    : QUICK_BAKEOFF_DEFAULTS;
  return {
    profile,
    limit: hasExplicitOption(rawArgs, 'limit')
      ? toNonNegativeInteger(limit, defaults.limit)
      : defaults.limit,
    embeddingSampleFiles: hasExplicitOption(rawArgs, 'embedding-sample-files')
      ? toNonNegativeInteger(embeddingSampleFiles, defaults.embeddingSampleFiles)
      : defaults.embeddingSampleFiles,
    embeddingSampleSeed: hasExplicitOption(rawArgs, 'embedding-sample-seed')
      ? toTrimmedString(embeddingSampleSeed, defaults.embeddingSampleSeed)
      : defaults.embeddingSampleSeed,
    skipCompare: hasExplicitOption(rawArgs, 'skip-compare')
      ? skipCompare === true
      : defaults.skipCompare,
    resume: hasExplicitOption(rawArgs, 'resume')
      ? resume !== false
      : defaults.resume
  };
}

/**
 * Resolve concrete index modes that stage4 should build for a requested mode.
 *
 * `build_index --mode prose` implicitly includes `extracted-prose`, while
 * `--mode all` includes every mode.
 *
 * @param {string} requestedMode
 * @returns {Array<'code'|'prose'|'extracted-prose'|'records'>}
 */
export function resolveBakeoffStage4Modes(requestedMode) {
  const normalized = String(requestedMode || '').trim().toLowerCase();
  if (normalized === 'code') return ['code'];
  if (normalized === 'prose') return ['prose', 'extracted-prose'];
  return ['code', 'prose', 'extracted-prose', 'records'];
}

/**
 * Resolve a cache build root pointer from a parsed `builds/current.json`.
 *
 * Canonical path containment is dependency-injected so callers can enforce
 * symlink-safe checks using their platform-specific identity helpers.
 *
 * @param {{
 *  repoCacheRoot:string,
 *  currentState?:{buildRoot?:string,buildId?:string}|null,
 *  existsSync?:(value:string)=>boolean,
 *  toCanonicalPath?:(value:string)=>string,
 *  isWithinRoot?:(candidate:string,root:string)=>boolean
 * }} input
 * @returns {string|null}
 */
export function resolveBakeoffCurrentBuildRoot({
  repoCacheRoot,
  currentState,
  existsSync = () => false,
  toCanonicalPath = (value) => path.resolve(value),
  isWithinRoot = (candidate, root) => {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}) {
  if (!repoCacheRoot || typeof repoCacheRoot !== 'string') return null;
  const state = currentState && typeof currentState === 'object' ? currentState : {};
  const repoCacheCanonical = toCanonicalPath(repoCacheRoot);
  const resolveWithinRepoCache = (value) => {
    if (!value || typeof value !== 'string') return null;
    const resolved = path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
    const normalized = toCanonicalPath(resolved);
    if (!isWithinRoot(normalized, repoCacheCanonical)) return null;
    return normalized;
  };
  const buildRootFromState = resolveWithinRepoCache(state.buildRoot);
  if (buildRootFromState && existsSync(buildRootFromState)) return buildRootFromState;
  if (typeof state.buildId === 'string' && state.buildId.trim()) {
    const buildIdRoot = resolveWithinRepoCache(path.join('builds', state.buildId.trim()));
    if (buildIdRoot && existsSync(buildIdRoot)) return buildIdRoot;
  }
  return null;
}
