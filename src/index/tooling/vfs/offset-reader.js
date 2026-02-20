import fsPromises from 'node:fs/promises';

const parseVfsManifestRowBuffer = (buffer, bytesRead) => {
  if (!buffer || !Number.isFinite(bytesRead) || bytesRead <= 0) return null;
  const line = buffer.slice(0, bytesRead).toString('utf8').trim();
  if (!line) return null;
  return JSON.parse(line);
};

/**
 * Parse one binary-framed JSON row (u32 byte length prefix + utf8 payload).
 * @param {Buffer} buffer
 * @param {number} bytesRead
 * @returns {object|null}
 */
export const parseBinaryJsonRowBuffer = (buffer, bytesRead) => {
  if (!buffer || !Number.isFinite(bytesRead) || bytesRead < 4) return null;
  const payloadBytes = buffer.readUInt32LE(0);
  if (!Number.isFinite(payloadBytes) || payloadBytes <= 0) return null;
  if ((payloadBytes + 4) > bytesRead) return null;
  const payload = buffer.subarray(4, 4 + payloadBytes).toString('utf8');
  if (!payload) return null;
  return JSON.parse(payload);
};

const coercePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Create a reusable VFS manifest offset reader that keeps a single file handle
 * open and reuses buffers across reads.
 * @param {{manifestPath:string,maxBufferPoolEntries?:number,maxCoalesceBytes?:number,parseRowBuffer?:(buffer:Buffer,bytesRead:number)=>object|null}} input
 * @returns {{readAtOffset:(input:{offset:number,bytes:number})=>Promise<object|null>,readRows:(input:{requests:Array<{offset:number,bytes:number}>})=>Promise<Array<object|null>>,stats:()=>object,close:()=>Promise<void>}}
 */
export const createVfsManifestOffsetReader = ({
  manifestPath,
  maxBufferPoolEntries = 64,
  maxCoalesceBytes = 1024 * 1024,
  parseRowBuffer = parseVfsManifestRowBuffer
}) => {
  const poolLimit = coercePositiveInt(maxBufferPoolEntries, 64);
  const coalesceLimit = coercePositiveInt(maxCoalesceBytes, 1024 * 1024);
  const bufferPool = new Map();
  let pooledBuffers = 0;
  let handlePromise = null;
  let closed = false;
  const stats = {
    handleOpens: 0,
    readCalls: 0,
    batchCalls: 0,
    coalescedReads: 0,
    coalescedBytes: 0,
    bufferAllocations: 0,
    bufferReuses: 0
  };

  const checkoutBuffer = (size) => {
    const key = coercePositiveInt(size, 0);
    if (!key) return null;
    const bucket = bufferPool.get(key);
    if (bucket?.length) {
      const value = bucket.pop();
      pooledBuffers = Math.max(0, pooledBuffers - 1);
      stats.bufferReuses += 1;
      return value;
    }
    stats.bufferAllocations += 1;
    return Buffer.alloc(key);
  };

  const checkinBuffer = (buffer) => {
    if (!buffer || !buffer.length || pooledBuffers >= poolLimit) return;
    const key = buffer.length;
    if (!bufferPool.has(key)) bufferPool.set(key, []);
    bufferPool.get(key).push(buffer);
    pooledBuffers += 1;
  };

  const openHandle = async () => {
    if (closed) {
      const err = new Error('VFS offset reader is closed.');
      err.code = 'ERR_VFS_OFFSET_READER_CLOSED';
      throw err;
    }
    if (!handlePromise) {
      stats.handleOpens += 1;
      handlePromise = fsPromises.open(manifestPath, 'r');
    }
    return handlePromise;
  };

  const readAtOffset = async ({ offset, bytes }) => {
    if (!Number.isFinite(offset) || !Number.isFinite(bytes) || bytes <= 0) return null;
    const handle = await openHandle();
    const expectedBytes = Math.max(1, Math.floor(bytes));
    const buffer = checkoutBuffer(expectedBytes);
    if (!buffer) return null;
    stats.readCalls += 1;
    try {
      const result = await handle.read(buffer, 0, expectedBytes, offset);
      return parseRowBuffer(buffer, result?.bytesRead || 0);
    } finally {
      checkinBuffer(buffer);
    }
  };

  const readRows = async ({ requests }) => {
    const list = Array.isArray(requests) ? requests : [];
    stats.batchCalls += 1;
    const out = new Array(list.length).fill(null);
    if (!list.length) return out;
    const handle = await openHandle();
    const normalized = [];
    for (let i = 0; i < list.length; i += 1) {
      const request = list[i] || {};
      const offset = Number(request.offset);
      const bytes = Number(request.bytes);
      if (!Number.isFinite(offset) || !Number.isFinite(bytes) || bytes <= 0) continue;
      normalized.push({
        index: i,
        offset,
        bytes: Math.max(1, Math.floor(bytes))
      });
    }
    normalized.sort((a, b) => a.offset - b.offset || a.index - b.index);
    let cursor = 0;
    while (cursor < normalized.length) {
      const first = normalized[cursor];
      const group = [first];
      let groupStart = first.offset;
      let groupEnd = first.offset + first.bytes;
      cursor += 1;
      while (cursor < normalized.length) {
        const next = normalized[cursor];
        const nextEnd = next.offset + next.bytes;
        const mergedStart = Math.min(groupStart, next.offset);
        const mergedEnd = Math.max(groupEnd, nextEnd);
        const mergedBytes = mergedEnd - mergedStart;
        if (mergedBytes > coalesceLimit) break;
        group.push(next);
        groupStart = mergedStart;
        groupEnd = mergedEnd;
        cursor += 1;
      }
      const readBytes = Math.max(0, groupEnd - groupStart);
      if (!readBytes) continue;
      const buffer = checkoutBuffer(readBytes);
      if (!buffer) continue;
      stats.readCalls += 1;
      if (group.length > 1) {
        stats.coalescedReads += 1;
        stats.coalescedBytes += readBytes;
      }
      try {
        const result = await handle.read(buffer, 0, readBytes, groupStart);
        const bytesRead = result?.bytesRead || 0;
        for (const request of group) {
          const relativeStart = request.offset - groupStart;
          const relativeEnd = relativeStart + request.bytes;
          if (relativeStart < 0 || relativeEnd > bytesRead) {
            out[request.index] = null;
            continue;
          }
          const rowBuffer = buffer.subarray(relativeStart, relativeEnd);
          out[request.index] = parseRowBuffer(rowBuffer, rowBuffer.length);
        }
      } finally {
        checkinBuffer(buffer);
      }
    }
    return out;
  };

  const close = async () => {
    closed = true;
    const pending = handlePromise;
    handlePromise = null;
    if (!pending) return;
    const handle = await pending;
    await handle.close();
  };

  return {
    readAtOffset,
    readRows,
    stats: () => ({
      ...stats,
      pooledBuffers
    }),
    close
  };
};

/**
 * Read multiple JSONL rows by byte offsets and lengths.
 * @param {{manifestPath:string,requests:Array<{offset:number,bytes:number}>,reader?:{readRows?:(input:{requests:Array<{offset:number,bytes:number}>})=>Promise<Array<object|null>>}|null}} input
 * @returns {Promise<Array<object|null>>}
 */
export const readVfsManifestRowsAtOffsets = async ({
  manifestPath,
  requests,
  reader = null
}) => {
  const list = Array.isArray(requests) ? requests : [];
  if (!list.length) return [];
  if (reader && typeof reader.readRows === 'function') {
    return reader.readRows({ requests: list });
  }
  const ephemeralReader = createVfsManifestOffsetReader({ manifestPath });
  try {
    return await ephemeralReader.readRows({ requests: list });
  } finally {
    await ephemeralReader.close();
  }
};

/**
 * Read a single JSONL row by byte offset and length.
 * @param {{manifestPath:string,offset:number,bytes:number,reader?:{readRows?:(input:{requests:Array<{offset:number,bytes:number}>})=>Promise<Array<object|null>>}|null}} input
 * @returns {Promise<object|null>}
 */
export const readVfsManifestRowAtOffset = async ({
  manifestPath,
  offset,
  bytes,
  reader = null
}) => {
  const rows = await readVfsManifestRowsAtOffsets({
    manifestPath,
    requests: [{ offset, bytes }],
    reader
  });
  return rows[0] || null;
};
