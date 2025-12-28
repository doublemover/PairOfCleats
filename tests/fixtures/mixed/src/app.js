import config from './config.js';
import { createLogger } from './logger.js';

const path = require('path');

export const version = '1.0.0';

export function buildPath(name) {
  return path.join(config.baseDir, name);
}

export class TaskRunner {
  constructor(name) {
    this.name = name;
  }

  run(task) {
    return task(this.name);
  }

  static fromEnv(env) {
    return new TaskRunner(env.USER || 'anon');
  }
}

export default function init() {
  const log = createLogger('init');
  log('starting');
  return new TaskRunner('default');
}

export const loadWidget = async (id) => {
  const mod = await import('./widget.js');
  return mod.createWidget(id);
};

module.exports.legacyAdd = function legacyAdd(a, b) {
  return a + b;
};
