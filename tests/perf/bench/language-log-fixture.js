import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createBenchLogger } from '../../../tools/bench/language-repos/logging.js';

const silentDisplay = {
  log: () => {},
  warn: () => {},
  error: () => {},
  logLine: () => {}
};

export const createBenchLanguageLogFixture = async (runSuffix) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, `bench-language-${runSuffix}`);
  const reposRoot = path.join(tempRoot, 'repos');
  const cacheRoot = path.join(tempRoot, 'cache');
  const resultsRoot = path.join(tempRoot, 'results');
  const masterLogPath = path.join(resultsRoot, 'logs', 'bench-language', `${runSuffix}.log`);

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(reposRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.mkdir(resultsRoot, { recursive: true });

  return {
    masterLogPath,
    reposRoot,
    logger: createBenchLogger({
      display: silentDisplay,
      configPath: path.join(tempRoot, 'repos.json'),
      reposRoot,
      cacheRoot,
      resultsRoot,
      masterLogPath,
      runSuffix,
      repoLogsEnabled: true
    })
  };
};
