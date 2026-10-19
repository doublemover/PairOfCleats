import path from 'node:path';

const LAYOUT = Object.freeze({
  'test-cache': ['tests', 'cache'],
  'test-coverage': ['tests', 'coverage'],
  'bench-cache': ['benchmarks'],
  'ci-cache': ['ci', 'cache'],
  'ci-home': ['ci', 'home']
});

/** Disposable contributor artifacts live below one ignored workspace root.
 * Durable test receipts remain owned by the runner's .testLogs interface.
 */
export const resolveDevelopmentArtifactPath = (root, category, ...segments) => {
  const layout = LAYOUT[category];
  if (!layout) throw new TypeError(`Unknown development artifact category: ${category}`);
  const base = path.resolve(root, 'temp', 'dev', ...layout);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new TypeError('Development artifact path must stay inside its category root.');
  }
  return target;
};
