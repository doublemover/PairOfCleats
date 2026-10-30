const MODE_FLAG_COVERAGE = Object.freeze({
  code: ['code'],
  prose: ['prose', 'extracted-prose'],
  'extracted-prose': ['extracted-prose'],
  records: ['records'],
  both: ['code', 'prose', 'extracted-prose'],
  all: ['code', 'prose', 'extracted-prose', 'records']
});
const splitAtEndOfOptions = (args) => {
  const markerIndex = args.findIndex((token) => String(token || '') === '--');
  if (markerIndex < 0) {
    return {
      options: args.slice(),
      positional: []
    };
  }
  return {
    options: args.slice(0, markerIndex),
    positional: args.slice(markerIndex)
  };
};

const removeModeFlag = (args) => {
  const { options, positional } = splitAtEndOfOptions(args);
  const output = [];
  for (let i = 0; i < options.length; i += 1) {
    const token = String(options[i] || '');
    if (token === '--mode') {
      if (i + 1 < options.length) i += 1;
      continue;
    }
    if (token.startsWith('--mode=')) continue;
    output.push(token);
  }
  return [...output, ...positional];
};

/**
 * Apply a per-repo mode override to prebuilt federated per-repo args.
 *
 * @param {string[]} args
 * @param {string|null} modeFlag
 * @returns {string[]}
 */
export const applyModeOverride = (args, modeFlag) => {
  const withoutMode = removeModeFlag(args);
  if (!modeFlag) return withoutMode;
  const { options, positional } = splitAtEndOfOptions(withoutMode);
  return [...options, '--mode', modeFlag, ...positional];
};

/**
 * Build one or more per-repo mode calls needed to satisfy a repo's eligible
 * mode set while avoiding known-unavailable modes.
 *
 * @param {string[]} eligibleModes
 * @returns {Array<{modeFlag:string,modesCovered:Set<string>}>}
 */
export const buildRepoModePlans = (eligibleModes = []) => {
  const eligible = new Set(eligibleModes);
  if (!eligible.size) return [];
  const has = (mode) => eligible.has(mode);
  if (has('code') && has('prose') && has('extracted-prose') && has('records')) {
    return [{ modeFlag: 'all', modesCovered: new Set(MODE_FLAG_COVERAGE.all) }];
  }
  if (has('code') && has('prose') && has('extracted-prose') && !has('records')) {
    return [{ modeFlag: 'both', modesCovered: new Set(MODE_FLAG_COVERAGE.both) }];
  }
  if (!has('code') && has('prose') && has('extracted-prose') && !has('records')) {
    return [{ modeFlag: 'prose', modesCovered: new Set(MODE_FLAG_COVERAGE.prose) }];
  }
  const plans = [];
  if (has('code')) {
    plans.push({ modeFlag: 'code', modesCovered: new Set(MODE_FLAG_COVERAGE.code) });
  }
  if (has('prose') || has('extracted-prose')) {
    if (has('prose') && has('extracted-prose')) {
      plans.push({ modeFlag: 'prose', modesCovered: new Set(MODE_FLAG_COVERAGE.prose) });
    } else if (has('extracted-prose')) {
      plans.push({ modeFlag: 'extracted-prose', modesCovered: new Set(MODE_FLAG_COVERAGE['extracted-prose']) });
    } else {
      plans.push({ modeFlag: 'prose', modesCovered: new Set(['prose']) });
    }
  }
  if (has('records')) {
    plans.push({ modeFlag: 'records', modesCovered: new Set(MODE_FLAG_COVERAGE.records) });
  }
  return plans;
};

