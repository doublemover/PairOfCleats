/**
 * Parse a comma-delimited model list into an array.
 * @param {string|string[]|null} value
 * @returns {string[]}
 */
export function parseModelList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Resolve the model list for comparison based on args/config/default.
 * @param {object} options
 * @param {string|string[]|null} options.argvModels
 * @param {string[]|null} options.configCompareModels
 * @param {string} options.defaultModel
 * @returns {string[]}
 */
export function resolveCompareModels({ argvModels, configCompareModels, defaultModel }) {
  const fromArgs = parseModelList(argvModels);
  const fromConfig = Array.isArray(configCompareModels) ? configCompareModels : [];
  const list = fromArgs.length ? fromArgs : (fromConfig.length ? fromConfig : [defaultModel]);
  return Array.from(new Set(list.map(String)));
}

/**
 * Resolve and validate the baseline model.
 * @param {string[]} models
 * @param {string|null} baselineArg
 * @returns {string}
 */
export function resolveBaseline(models, baselineArg) {
  const baseline = baselineArg || models[0];
  if (!models.includes(baseline)) {
    throw new Error(`Baseline model not in list: ${baseline}`);
  }
  return baseline;
}

/**
 * Resolve ANN enablement from CLI args or config defaults.
 * @param {object} options
 * @param {string[]} options.rawArgs
 * @param {object} options.argv
 * @param {object} options.userConfig
 * @returns {{annEnabled:boolean,annFlagPresent:boolean}}
 */
export function resolveAnnSetting({ rawArgs, argv, userConfig }) {
  const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
  const annDefault = userConfig.search?.annDefault !== false;
  const annEnabled = annFlagPresent ? argv.ann : annDefault;
  return { annEnabled, annFlagPresent };
}
