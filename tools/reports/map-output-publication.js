import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';

/** Requested deliverables are individually atomic; the batch reports partial success. */
export const publishMapOutput = async ({ kind, target, content, write = atomicWriteText }) => {
  const outPath = path.resolve(target);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  try {
    await write(outPath, bytes, { mkdir: true, newline: false });
    return { kind, path: outPath, ok: true, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    return { kind, path: outPath, ok: false,
      error: { code: error?.code || 'ERR_MAP_OUTPUT_WRITE', message: error?.message || String(error) } };
  }
};
