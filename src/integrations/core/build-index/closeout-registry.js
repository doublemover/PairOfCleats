const toMessage = (error) => (
  error?.message || String(error || 'unknown error')
);

/**
 * Create a deterministic stage closeout runner with structured step logging.
 *
 * @param {{
 *   stage?:string,
 *   log?:(line:string)=>void,
 *   warn?:(line:string)=>void
 * }} [input]
 * @returns {{
 *   addStep:(input:{label:string,run:()=>Promise<unknown>|unknown,required?:boolean,requiresPriorSuccess?:boolean})=>void,
 *   run:()=>Promise<{steps:Array<object>,error:Error|null}>
 * }}
 */
export const createCloseoutRegistry = ({
  stage = 'stage',
  log = null,
  warn = null
} = {}) => {
  const steps = [];
  const emitLog = (line) => {
    if (typeof log !== 'function') return;
    try {
      log(line);
    } catch {}
  };
  const emitWarn = (line) => {
    if (typeof warn === 'function') {
      try {
        warn(line);
      } catch {}
      return;
    }
    emitLog(line);
  };
  const addStep = ({
    label,
    run,
    required = true,
    requiresPriorSuccess = false
  } = {}) => {
    const stepLabel = String(label || '').trim();
    if (!stepLabel) throw new Error('closeout step label is required');
    if (typeof run !== 'function') throw new Error(`closeout step ${stepLabel} requires run()`);
    steps.push({
      label: stepLabel,
      run,
      required: required !== false,
      requiresPriorSuccess: requiresPriorSuccess === true
    });
  };
  const run = async () => {
    const outcomes = [];
    const errors = [];
    for (const step of steps) {
      const startedAtMs = Date.now();
      emitLog(`[closeout] ${stage}.${step.label} start`);
      try {
        if (step.requiresPriorSuccess && errors.length) {
          throw Object.assign(new Error(`Required closeout steps did not complete before ${step.label}.`), {
            code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE', cacheOwnershipPending: true,
            cause: new AggregateError([...errors], 'Prior required closeout failures.')
          });
        }
        const value = await step.run();
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        emitLog(`[closeout] ${stage}.${step.label} done (${elapsedMs}ms)`);
        outcomes.push({
          label: step.label,
          ok: true,
          elapsedMs,
          required: step.required,
          value
        });
      } catch (error) {
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        emitWarn(
          `[closeout] ${stage}.${step.label} failed after ${elapsedMs}ms: ${toMessage(error)}`
        );
        outcomes.push({
          label: step.label,
          ok: false,
          elapsedMs,
          required: step.required,
          error
        });
        if (step.required) errors.push(error);
      }
    }
    if (errors.length === 0) {
      return { steps: outcomes, error: null };
    }
    if (errors.length === 1) {
      return { steps: outcomes, error: errors[0] };
    }
    const pending = errors.filter(error => error?.cacheOwnershipPending === true);
    return {
      steps: outcomes,
      error: Object.assign(new AggregateError(errors, `[closeout] ${stage} closeout failed (${errors.length} step(s)).`), {
        cacheOwnershipPending: pending.length > 0,
        ...(pending.length ? { cacheOwnershipReleased: () => pending.every(error => {
          try { return error.cacheOwnershipReleased?.() === true; } catch { return false; }
        }) } : {})
      })
    };
  };
  return {
    addStep,
    run
  };
};

