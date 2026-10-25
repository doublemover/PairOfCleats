import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { withContainedFile } from './contained-file.js';

const changed = () => Object.assign(new Error('Dictionary input changed or ended before its admitted extent.'), { code: 'ERR_DICTIONARY_INPUT_CHANGED' });
const nativeError = value => value !== null && ['object', 'function'].includes(typeof value)
  ? value : new Error(String(value), { cause: value });

/** ReadStream framing uses the existing contained descriptor owner for every
 * native operation. Its close callback waits for that owner's actual close;
 * the stream never closes a second, independently opened pathname descriptor.
 */
export const createDictionaryInputStream = (file, root) => {
  let descriptor = null, scope = null, before = null, complete = false, bytes = 0, finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file, { fs: {
    open(_file, _flags, _mode, callback) {
      let admitted = false;
      scope = withContainedFile(root, file, async owner => {
        descriptor = owner;
        before = fs.fstatSync(owner.fd, { bigint: true });
        if (!before.isFile() || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw changed();
        admitted = true; callback(null, owner.fd);
        const outcome = await finished;
        if (outcome.failed) throw outcome.failure;
      });
      scope.catch(error => { if (!admitted) callback(nativeError(error)); });
    },
    read(fd, buffer, offset, length, position, callback) {
      const reading = Promise.resolve().then(async () => {
        if (!descriptor || fd !== descriptor.fd) throw changed();
        const allowed = Math.min(length, Math.max(1, Number(before.size) - bytes + 1));
        const result = await descriptor.read(buffer, offset, allowed, position);
        if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > allowed) throw changed();
        bytes += result.bytesRead;
        if (bytes > Number(before.size)) throw changed();
        if (result.bytesRead) hash.update(buffer.subarray(offset, offset + result.bytesRead));
        else {
          const after = fs.fstatSync(fd, { bigint: true });
          if (bytes !== Number(before.size) || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw changed();
          descriptor.verify(); complete = true;
        }
        return result.bytesRead;
      });
      reading.then(bytesRead => callback(null, bytesRead, buffer), error => callback(nativeError(error)));
    },
    close(_fd, callback) {
      let failure = null, failed = false;
      try { failure = stream.errored; failed = failure !== null && failure !== undefined; }
      catch (error) { failure = error; failed = true; }
      finish({ failed, failure });
      scope.then(() => callback(null), error => callback(nativeError(error)));
    }
  } });
  return { stream, opened: () => before !== null, receipt: () => {
    if (!complete || !stream.closed) throw changed();
    return Object.freeze({ outcome: 'complete', bytes, hash: hash.digest('hex'), hashAlgorithm: 'sha256',
      sourceIdentity: Object.freeze({ dev: String(before.dev), ino: String(before.ino) }) });
  } };
};
