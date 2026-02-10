/**
 * Create a no-op task object for display-less contexts.
 * @returns {object}
 */
export function createNoopTask() {
  return {
    tick() {},
    set() {},
    done() {},
    fail() {},
    update() {}
  };
}

/**
 * Resolve a task factory and fall back to no-op tasks when unavailable.
 * @param {Function|null|undefined} taskFactory
 * @returns {(label:string, options?:object) => object}
 */
export function resolveTaskFactory(taskFactory) {
  return typeof taskFactory === 'function' ? taskFactory : (() => createNoopTask());
}
