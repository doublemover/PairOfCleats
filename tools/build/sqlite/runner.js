import { createTaskFactory, createToolDisplay } from '../../shared/cli-display.js';
import {
  buildSqliteIndex as coreBuildSqliteIndex,
  runBuildSqliteIndexWithConfig as coreRunBuildSqliteIndexWithConfig,
  normalizeValidateMode
} from '../../../src/storage/sqlite/build/runner.js';

export { normalizeValidateMode };

const resolveDisplayContext = ({ argv, options }) => {
  const externalLogger = options?.logger && typeof options.logger === 'object'
    ? options.logger
    : null;
  if (externalLogger) {
    return {
      logger: externalLogger,
      taskFactory: typeof options.taskFactory === 'function' ? options.taskFactory : null,
      onFinalize: typeof options.onFinalize === 'function' ? options.onFinalize : null
    };
  }
  const display = createToolDisplay({ argv: argv || {}, stream: process.stderr });
  const taskFactory = createTaskFactory(display);
  return {
    logger: display,
    taskFactory,
    onFinalize: () => {
      display.close();
    }
  };
};

/**
 * Build sqlite indexes without CLI parsing.
 * @param {object} options
 * @returns {Promise<{ok:boolean,mode:string,outPath:string,outputPaths:object}>}
 */
export async function buildSqliteIndex(options = {}) {
  const argv = {
    progress: options.progress || 'auto',
    verbose: options.verbose === true,
    quiet: options.quiet === true
  };
  const { logger, taskFactory, onFinalize } = resolveDisplayContext({ argv, options });
  return coreBuildSqliteIndex({
    ...options,
    logger,
    taskFactory: taskFactory || undefined,
    onFinalize: onFinalize || undefined
  });
}

/**
 * Build sqlite indexes from artifacts or incremental bundles.
 * @param {object} parsed
 * @param {object} [options]
 * @returns {Promise<{ok:boolean,mode:string,outPath:string,outputPaths:object}>}
 */
export async function runBuildSqliteIndexWithConfig(parsed, options = {}) {
  const { logger, taskFactory, onFinalize } = resolveDisplayContext({ argv: parsed?.argv || {}, options });
  return coreRunBuildSqliteIndexWithConfig(parsed, {
    ...options,
    logger,
    taskFactory: taskFactory || undefined,
    onFinalize: onFinalize || undefined
  });
}
