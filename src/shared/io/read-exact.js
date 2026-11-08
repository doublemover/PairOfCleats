import { throwIfAborted } from '../abort.js';
/** Fill a bounded positioned span, returning short only at actual EOF. */
export const readExactAt = async (handle, buffer, offset, length, position, { signal = null } = {}) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0
    || offset + length > buffer.byteLength || !Number.isSafeInteger(position) || position < 0
    || !Number.isSafeInteger(position + length)) throw new RangeError('Invalid positioned read span.');
  let filled = 0;
  while (filled < length) {
    throwIfAborted(signal);
    const result = await handle.read(buffer, offset + filled, length - filled, position + filled);
    const bytesRead = result?.bytesRead;
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > length - filled) {
      throw Object.assign(new Error('Invalid filesystem read progress.'), { code: 'ERR_IO_READ_PROGRESS' });
    }
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  throwIfAborted(signal);
  return { bytesRead: filled, buffer };
};
