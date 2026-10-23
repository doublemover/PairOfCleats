/**
 * A selected command outcome. Unknown validation/publication is kept explicit;
 * repository-global preprocess files never qualify counts for this invocation.
 * @typedef {{schemaVersion:1,repo:string|null,status:string,requestedStages:string[],stages:object[],generations:object[],counts:null}} BuildIndexOutcome
 */
export const createBuildIndexOutcome = ({ result = {}, repo = null, requestedStage = null, modes = [], error = null } = {}) => {
  const entries = ['stage1', 'stage2', 'stage3', 'stage4'].flatMap(stage => result[stage] ? [[stage, result[stage]]] : []);
  if (!entries.length && result.stage) entries.push([result.stage, result]);
  if (result.recovery) entries.push([result.recovery.stage, result.recovery]);
  const stages = entries.map(([stage, value]) => {
    const facts = value.embeddings || value.sqlite || value;
    const perModeFacts = Array.isArray(facts.perMode) ? facts.perMode.map(entry => entry.embeddings || entry) : [];
    const status = facts.cancelled || value.cancelled ? 'cancelled'
      : facts.notAdmitted || value.notAdmitted || perModeFacts.some(entry => entry.notAdmitted) ? 'not-admitted'
        : facts.queued || value.queued || perModeFacts.some(entry => entry.queued) ? 'pending'
          : facts.background || value.background ? 'pending'
            : facts.skipped || value.skipped ? 'skipped'
              : 'completed';
    return { stage, status, modes: value.modes || modes, reason: facts.reason || value.reason || null,
      queueId: facts.queueId || value.queueId || null,
      validation: value.validation || { status: 'unknown' },
      publication: value.publication || { status: 'unknown' },
      diagnosticEvidence: facts.diagnosticEvidence || value.diagnosticEvidence || null,
      perMode: Array.isArray(facts.perMode) ? facts.perMode : null };
  });
  const generations = entries.filter(([, value]) => value.buildId || value.buildRoot || value.runtimeAttemptId)
    .map(([stage, value]) => ({ stage, buildId: value.buildId || null, buildRoot: value.buildRoot || null,
      attemptId: value.runtimeAttemptId || null, modes: value.modes || modes,
      receiptPath: value.buildRoot ? `${value.buildRoot.replace(/[\\/]$/u, '')}/build_state.json` : null }));
  for (const [stage, value] of entries) {
    for (const generation of value.modeGenerations || []) generations.push({ stage, ...generation, modes: [generation.mode] });
  }
  const status = error ? (error.name === 'AbortError' ? 'cancelled' : 'failed')
    : stages.some(row => row.status === 'cancelled') ? 'cancelled'
      : stages.some(row => row.status === 'not-admitted') ? 'not-admitted'
        : stages.some(row => row.status === 'pending') ? 'pending'
          : stages.length && stages.every(row => row.status === 'skipped') ? 'skipped'
            : stages.some(row => row.publication.status === 'published') ? 'index-published' : 'stage-completed';
  const capabilityByStage = { stage1: 'sparse-retrieval', stage2: 'semantic-enrichment', stage3: 'embeddings', stage4: 'sqlite' };
  const capabilities = stages.map(row => ({ capability: capabilityByStage[row.stage] || row.stage,
    status: row.status, modes: row.modes, reason: row.reason }));
  return { schemaVersion: 1, repo: result.repo || repo, status, capabilities,
    requestedStages: requestedStage ? [requestedStage] : ['stage2', 'stage3', 'stage4'],
    stages, generations, counts: null,
    ...(error?.publication ? { publication: error.publication } : {}),
    error: error ? { code: error.code || null, message: String(error.message || error) } : null };
};

export const describeBuildIndexOutcome = (outcome, seconds) => {
  const label = { 'index-published': 'Index generation published', pending: 'Jobs queued or running in the background',
    skipped: 'Requested work skipped by configuration', 'not-admitted': 'Requested work was not admitted',
    cancelled: 'Index command cancelled', failed: 'Index command failed', 'stage-completed': 'Requested stage completed' }[outcome.status];
  const skipped = outcome.stages.filter(row => row.status === 'skipped').map(row => row.stage);
  return `${label || 'Index command completed'} in ${seconds} seconds.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}`;
};
