import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WINDOWS_CDB_CHILD_CONTEXT, WINDOWS_CDB_OUTPUT_BYTES as OUTPUT_BYTES } from './windows-cdb-protocol.js';

/** Installed only in the explicit diagnostic child. The exit event, rather
 * than completion of import(), witnesses ordinary asynchronous work finishing.
 * Each bounded output append closes before returning to native application work.
 */
export const runWindowsCdbChild = async () => {
  const context = JSON.parse(process.env[WINDOWS_CDB_CHILD_CONTEXT] || '{}');
  delete process.env[WINDOWS_CDB_CHILD_CONTEXT];
  if (typeof context.token !== 'string' || !/^[a-f0-9-]{36}$/u.test(context.token)
    || !path.isAbsolute(context.directory || '') || !path.isAbsolute(context.cwd || '')) {
    throw new Error('Explicit CDB child context is missing.');
  }
  const writeJson = (name, value) => fs.writeFileSync(path.join(context.directory, name), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  const state = { stdout: { bytes: 0, capturedBytes: 0, truncated: false }, stderr: { bytes: 0, capturedBytes: 0, truncated: false } };
  let outputFailure = null;
  for (const name of ['stdout', 'stderr']) {
    const stream = process[name], write = stream.write;
    const file = path.join(context.directory, `child-${name}.bin`);
    fs.writeFileSync(file, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    stream.write = function (chunk, encoding, callback) {
      try {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8')
          : chunk instanceof Uint8Array ? Buffer.from(chunk) : null;
        if (bytes) {
          const entry = state[name], remaining = Math.max(0, OUTPUT_BYTES - entry.capturedBytes);
          entry.bytes += bytes.length;
          if (!Number.isSafeInteger(entry.bytes)) throw new Error('Diagnostic stream byte counter overflow.');
          if (remaining) {
            const slice = bytes.subarray(0, remaining);
            fs.appendFileSync(file, slice); entry.capturedBytes += slice.length;
          }
          entry.truncated = entry.bytes > entry.capturedBytes;
        }
      } catch (error) { outputFailure ||= typeof error?.code === 'string' ? error.code : 'child-output-write-failed'; }
      return write.call(this, chunk, encoding, callback);
    };
  }
  process.once('exit', exitCode => {
    // Failure here leaves no successful reply; the parent still owns the target
    // and preserves its debugger output/dump instead of inventing a zero exit.
    writeJson('child-exit.json', { schemaVersion: 1, token: context.token, pid: process.pid,
      exitCode, outputCapture: state, outputFailure });
  });
  writeJson('child-launch.json', { schemaVersion: 1, token: context.token, pid: process.pid,
    node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch });
  process.chdir(context.cwd);
  await import(pathToFileURL(path.join(context.directory, 'application.mjs')).href);
};
