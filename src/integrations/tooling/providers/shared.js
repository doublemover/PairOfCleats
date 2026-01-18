export const uniqueTypes = (values) => Array.from(new Set((values || []).filter(Boolean)));

export const createToolingEntry = () => ({
  returns: [],
  params: {},
  signature: '',
  paramNames: []
});

export const mergeToolingEntry = (target, incoming) => {
  if (!incoming) return target;
  if (incoming.signature && !target.signature) target.signature = incoming.signature;
  if (incoming.paramNames?.length && (!target.paramNames || !target.paramNames.length)) {
    target.paramNames = incoming.paramNames.slice();
  }
  if (Array.isArray(incoming.returns) && incoming.returns.length) {
    target.returns = uniqueTypes([...(target.returns || []), ...incoming.returns]);
  }
  if (incoming.params && typeof incoming.params === 'object') {
    if (!target.params || typeof target.params !== 'object') target.params = {};
    for (const [name, types] of Object.entries(incoming.params)) {
      if (!name || !Array.isArray(types)) continue;
      const existing = target.params[name] || [];
      target.params[name] = uniqueTypes([...(existing || []), ...types]);
    }
  }
  return target;
};

export const mergeToolingMaps = (base, incoming) => {
  for (const [key, value] of incoming || []) {
    if (!base.has(key)) {
      const entry = createToolingEntry();
      mergeToolingEntry(entry, value);
      base.set(key, entry);
      continue;
    }
    mergeToolingEntry(base.get(key), value);
  }
  return base;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createToolingGuard = ({
  name,
  timeoutMs = 15000,
  retries = 2,
  breakerThreshold = 3,
  log = () => {}
} = {}) => {
  let consecutiveFailures = 0;
  const isOpen = () => consecutiveFailures >= breakerThreshold;
  const reset = () => {
    consecutiveFailures = 0;
  };
  const recordFailure = (err, label) => {
    consecutiveFailures += 1;
    if (label) log(`[tooling] ${name} ${label} failed (${consecutiveFailures}/${breakerThreshold}): ${err?.message || err}`);
    if (isOpen()) log(`[tooling] ${name} circuit breaker tripped.`);
  };
  const run = async (fn, { label, timeoutOverride } = {}) => {
    if (isOpen()) throw new Error(`${name} tooling disabled (circuit breaker).`);
    let attempt = 0;
    while (attempt <= retries) {
      try {
        const result = await fn({ timeoutMs: timeoutOverride || timeoutMs });
        reset();
        return result;
      } catch (err) {
        recordFailure(err, label);
        attempt += 1;
        if (isOpen() || attempt > retries) throw err;
        const delay = attempt === 1 ? 250 : 1000;
        await wait(delay);
      }
    }
    return null;
  };
  return {
    isOpen,
    run
  };
};
