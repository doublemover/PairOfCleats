import { spawnSync } from 'node:child_process';

export const fail = (message) => {
  console.error(message);
  process.exit(1);
};

export const hasPython = () => {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
};

export const findSafely = (items, predicate) => items.find((item) => {
  try {
    return predicate(item);
  } catch {
    return false;
  }
});

export const runEnabledCases = async (cases) => {
  for (const testCase of cases) {
    if (!testCase.enabled) continue;
    await testCase.validate(testCase.find?.());
  }
};
