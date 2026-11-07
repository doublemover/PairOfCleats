import fs from 'node:fs';
import path from 'node:path';
import { toRealPathSync } from '../../src/workspace/identity.js';

/** Synchronous no-follow fault injection, without creating an OS link. Assert
 * the production refusal code as well as inspection/open counts; ENOENT alone
 * must not stand in for the reparse boundary. Native resolution is separate.
 */
export const withVirtualReparsePath = ({ file, statSource, directory = false }, action) => {
  if (typeof action !== 'function') throw new TypeError('Virtual reparse action must be synchronous.');
  const target = path.join(toRealPathSync(path.dirname(file)), path.basename(file));
  const lstat = fs.lstatSync, open = fs.openSync;
  try { lstat(target); throw new Error('A virtual reparse path must not replace an existing object.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stat = Object.create(lstat(statSource, { bigint: true }), {
    isSymbolicLink: { value: () => true }, isFile: { value: () => false }, isDirectory: { value: () => directory }
  });
  let inspected = 0, opened = 0;
  const observations = Object.freeze({ get inspected() { return inspected; }, get opened() { return opened; } });
  fs.lstatSync = function (input, ...args) {
    if (typeof input === 'string' && path.resolve(input) === target) { inspected++; return stat; }
    return lstat.call(this, input, ...args);
  };
  fs.openSync = function (input, ...args) {
    if (typeof input === 'string') {
      const relative = path.relative(target, path.resolve(input));
      if (!relative || directory && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) opened++;
    }
    return open.call(this, input, ...args);
  };
  try {
    const result = action(observations);
    if (typeof result?.then === 'function') throw new TypeError('Virtual reparse action cannot outlive its synchronous scope.');
    return result;
  } finally { fs.lstatSync = lstat; fs.openSync = open; }
};
