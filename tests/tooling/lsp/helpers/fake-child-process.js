import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 0;
    this.killed = false;
    this.exitCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killCalls = 0;
  }

  kill(signal = null) {
    this.killCalls += 1;
    this.killed = true;
    this.exitCode = this.exitCode === null ? 0 : this.exitCode;
    queueMicrotask(() => {
      this.emit('exit', this.exitCode, signal);
      this.emit('close', this.exitCode, signal);
    });
    return true;
  }

  unref() {}
}

export const createTrackedFakeChildProcessSpawner = ({ configureChild = null } = {}) => {
  const spawnedChildren = [];
  return {
    spawnedChildren,
    spawnProcess: () => {
      const child = new FakeChildProcess();
      spawnedChildren.push(child);
      if (configureChild) {
        configureChild(child);
      }
      return child;
    }
  };
};
