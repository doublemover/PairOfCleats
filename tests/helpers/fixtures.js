import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './root.js';
import { makeTempDir } from './temp.js';

export const copyFixtureToTemp = async (name, { prefix = 'pairofcleats-fixture-' } = {}) => {
  if (!name) throw new Error('copyFixtureToTemp requires a fixture name');
  const root = repoRoot();
  const source = path.join(root, 'tests', 'fixtures', name);
  const targetRoot = await makeTempDir(prefix);
  const target = path.join(targetRoot, name);
  await fsPromises.cp(source, target, { recursive: true });
  return target;
};
