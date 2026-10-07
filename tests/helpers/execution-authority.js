import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Explicitly grant only the benign fixture root owned by this test process. */
export const grantFixtureRepositoryExecution = (repoRoot) => {
  assert.ok(path.isAbsolute(repoRoot));
  const root = fs.realpathSync(repoRoot);
  const previous = process.env.PAIROFCLEATS_TRUSTED_REPOS;
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([root]);
  const restore = () => {
    if (previous === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
    else process.env.PAIROFCLEATS_TRUSTED_REPOS = previous;
  };
  process.once('exit', restore);
  return restore;
};
