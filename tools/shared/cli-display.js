import { createDisplay } from '../../src/shared/cli/display.js';
import { createNoopTask } from '../../src/shared/cli/noop-task.js';

/**
 * Create a display instance using common CLI flags.
 * @param {object} options
 * @param {object} [options.argv]
 * @param {NodeJS.WritableStream} [options.stream]
 * @param {string|undefined} [options.progressMode]
 * @returns {ReturnType<typeof createDisplay>}
 */
export function createToolDisplay({ argv, stream = process.stderr, progressMode, displayOptions } = {}) {
  return createDisplay({
    stream,
    progressMode: progressMode ?? argv?.progress,
    verbose: argv?.verbose === true,
    quiet: argv?.quiet === true,
    ...(displayOptions || {})
  });
}

export function createDisplayLoggerAdapter(display) {
  return {
    log(message, meta = null) {
      if (meta && typeof meta === 'object' && meta.kind === 'status') {
        display?.logLine?.(message, meta);
        return;
      }
      display?.log?.(message, meta);
    },
    warn(message, meta = null) {
      display?.warn?.(message, meta);
    },
    error(message, meta = null) {
      display?.error?.(message, meta);
    }
  };
}

/**
 * Create a common CLI display and logger adapter for tool internals.
 * @param {Parameters<typeof createToolDisplay>[0]} options
 * @returns {{ display: ReturnType<typeof createToolDisplay>, logger: { log: Function, warn: Function, error: Function } }}
 */
export function createToolDisplayLogger(options = {}) {
  const display = createToolDisplay(options);
  return {
    display,
    logger: createDisplayLoggerAdapter(display)
  };
}

/**
 * Create a task factory that falls back to no-op tasks.
 * @param {object|null} display
 * @returns {(label:string, options?:object) => object}
 */
export function createTaskFactory(display) {
  if (display?.task) {
    return display.task.bind(display);
  }
  return () => createNoopTask();
}
