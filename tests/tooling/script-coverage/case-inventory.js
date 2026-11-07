import fs from 'node:fs/promises';
import path from 'node:path';
import { SCRIPT_COVERAGE_GROUPS } from './actions.js';

export const buildScriptCoverageCaseInventories = actions => Object.fromEntries(
  SCRIPT_COVERAGE_GROUPS.map(group => [group, { schemaVersion: 1,
    cases: [...actions.filter(action => action.group === group).map(action => action.label),
      ...(group === 'tools' ? ['shell-scripts'] : [])] }])
);

/** Generate bounded process cases from the existing action definitions. */
export const writeScriptCoverageCaseInventories = async (directory, actions) => {
  for (const [group, inventory] of Object.entries(buildScriptCoverageCaseInventories(actions))) {
    await fs.writeFile(path.join(directory, `${group}.test.js.cases.json`), JSON.stringify(inventory, null, 2) + '\n');
  }
};
