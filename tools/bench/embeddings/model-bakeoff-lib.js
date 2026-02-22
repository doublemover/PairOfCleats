import path from 'node:path';

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
