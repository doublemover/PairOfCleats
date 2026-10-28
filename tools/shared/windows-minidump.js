// MINIDUMP structures use four-byte packing, including their 64-bit members.
// This validates bounded diagnostic evidence; it is not a memory-safety oracle.
const fail = reason => Object.assign(new Error(`Invalid Windows minidump: ${reason}`), {
  code: 'ERR_WINDOWS_MINIDUMP', reason
});
const MAX_STREAMS = 4096;
const MAX_THREADS = 4096;
const MAX_MODULES = 4096;
export const WINDOWS_MINIDUMP_MAX_BYTES = 16 * 1024 * 1024;

export const inspectWindowsMinidump = (buffer, { expectedPid } = {}) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32 || buffer.length > WINDOWS_MINIDUMP_MAX_BYTES) throw fail('byte-extent');
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0 || expectedPid > 0xffffffff) throw fail('expected-process-id');
  const range = (offset, size) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0
      || offset > buffer.length || size > buffer.length - offset) throw fail('stream-extent');
    return offset;
  };
  const u32 = offset => buffer.readUInt32LE(range(offset, 4));
  const u64 = offset => buffer.readBigUInt64LE(range(offset, 8));
  const location = offset => { const size = u32(offset), rva = u32(offset + 4); range(rva, size); return { size, rva }; };
  const string = offset => {
    const bytes = u32(offset);
    if (bytes % 2 || bytes > 32768) throw fail('module-name-extent');
    range(offset + 4, bytes);
    return buffer.toString('utf16le', offset + 4, offset + 4 + bytes);
  };
  if (u32(0) !== 0x504d444d || (u32(4) & 0xffff) !== 0xa793) throw fail('signature-or-version');
  const count = u32(8), directory = u32(12);
  if (count < 1 || count > MAX_STREAMS || directory < 32) throw fail('stream-directory');
  range(directory, count * 12);
  // A normal minidump only: never accept full process memory as this collector's
  // bounded artifact, even if it happens to fit the current byte allowance.
  if ((u64(24) & 2n) !== 0n) throw fail('full-memory-dump');
  const streams = new Map();
  for (let index = 0; index < count; index++) {
    const at = directory + index * 12, type = u32(at), data = location(at + 4);
    if (data.size && (data.rva < 32 || data.rva < directory + count * 12 && data.rva + data.size > directory)) throw fail('stream-overlaps-header');
    if ([3, 4, 6, 15].includes(type)) {
      if (streams.has(type)) throw fail('duplicate-required-stream');
      streams.set(type, data);
    }
  }
  const requireStream = (type, minBytes) => {
    const value = streams.get(type);
    if (!value || value.size < minBytes) throw fail(`missing-stream-${type}`);
    return value;
  };
  const misc = requireStream(15, 24);
  if (u32(misc.rva) < 24 || u32(misc.rva) > misc.size || !(u32(misc.rva + 4) & 1)
    || u32(misc.rva + 8) !== expectedPid) throw fail('process-identity');
  const exception = requireStream(6, 168), at = exception.rva;
  const threadId = u32(at), exceptionCode = u32(at + 8), parameterCount = u32(at + 32);
  if (!threadId || parameterCount > 15 || exceptionCode === 0) throw fail('exception-record');
  const context = location(at + 160);
  if (!context.size) throw fail('exception-context');
  const threads = requireStream(3, 4), threadCount = u32(threads.rva);
  if (!threadCount || threadCount > MAX_THREADS || threadCount * 48 > threads.size - 4) throw fail('thread-list');
  const threadIds = new Set();
  for (let index = 0; index < threadCount; index++) {
    const base = threads.rva + 4 + index * 48, id = u32(base);
    if (!id || threadIds.has(id)) throw fail('thread-identity');
    threadIds.add(id);
    location(base + 32); // The stack's memory location follows its 64-bit VA.
    if (!location(base + 40).size) throw fail('thread-context');
  }
  if (!threadIds.has(threadId)) throw fail('exception-thread-not-recorded');
  const list = requireStream(4, 4), moduleCount = u32(list.rva);
  if (!moduleCount || moduleCount > MAX_MODULES || moduleCount * 108 > list.size - 4) throw fail('module-list');
  const modules = [];
  for (let index = 0; index < moduleCount; index++) {
    const base = list.rva + 4 + index * 108, name = string(u32(base + 20));
    const codeView = location(base + 76);
    location(base + 84);
    let pdb = null;
    if (codeView.size >= 24 && buffer.toString('ascii', codeView.rva, codeView.rva + 4) === 'RSDS') {
      if (codeView.size > 32768) throw fail('codeview-extent');
      const start = codeView.rva + 24, end = buffer.indexOf(0, start);
      if (end < start || end >= codeView.rva + codeView.size) throw fail('codeview-name');
      pdb = Object.freeze({ guidBytes: buffer.subarray(codeView.rva + 4, codeView.rva + 20).toString('hex'),
        age: u32(codeView.rva + 20), path: buffer.toString('utf8', start, end) });
    }
    modules.push(Object.freeze({ name, baseAddress: `0x${u64(base).toString(16)}`, imageBytes: u32(base + 8),
      checksum: u32(base + 12), timeDateStamp: u32(base + 16), pdb }));
  }
  return Object.freeze({ schemaVersion: 1, processId: expectedPid, threadId, exceptionCode,
    exceptionHex: `0x${exceptionCode.toString(16).padStart(8, '0')}`, exceptionAddress: `0x${u64(at + 24).toString(16)}`,
    exceptionParameters: Object.freeze(Array.from({ length: parameterCount }, (_, index) => `0x${u64(at + 40 + index * 8).toString(16)}`)),
    threadCount, modules: Object.freeze(modules), bytes: buffer.length,
    qualification: 'bounded-minidump-structure-and-target-pid' });
};
