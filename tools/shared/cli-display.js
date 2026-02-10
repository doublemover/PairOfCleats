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

export { createNoopTask };
