const windowsMachines = { x64: 0x8664, arm64: 0xaa64 };

/** Header/architecture admission only; this does not attest runtime behavior. */
export const inspectWindowsTargetBytes = (bytes, arch, { executable = false } = {}) => {
  const expected = windowsMachines[arch];
  if (!expected || !Buffer.isBuffer(bytes) || bytes.length < 20) throw new Error('Missing supported target output.');
  let offset = 0;
  if (executable) {
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Compiler capability output is not a PE image.');
    const header = bytes.readUInt32LE(0x3c);
    if (header < 64 || header > bytes.length - 24 || bytes.readUInt32LE(header) !== 0x4550) throw new Error('Invalid PE target header.');
    offset = header + 4;
  }
  const actual = bytes.readUInt16LE(offset);
  if (actual !== expected) throw new Error(`Compiler target machine disagrees: expected ${arch}, observed 0x${actual.toString(16)}.`);
  return { format: executable ? 'PE' : 'COFF', arch, machine: actual };
};

export const inspectExecutableTargetBytes = (bytes, { platform, triple }) => {
  const arch = triple.startsWith('x86_64-') ? 'x64' : triple.startsWith('aarch64-') ? 'arm64' : null;
  if (!arch || !Buffer.isBuffer(bytes)) throw new Error('Unsupported executable target.');
  if (platform === 'windows') return inspectWindowsTargetBytes(bytes, arch, { executable: true });
  if (platform === 'linux') {
    if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[4] !== 2 || ![1, 2].includes(bytes[5])) {
      throw new Error('TUI artifact is not a supported ELF64 executable.');
    }
    const machine = bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
    if (machine !== (arch === 'x64' ? 62 : 183)) throw new Error('TUI ELF target machine disagrees with target triple.');
    return { format: 'ELF64', arch, machine };
  }
  if (platform === 'macos') {
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error('TUI artifact is not a supported Mach-O64 executable.');
    const machine = bytes.readUInt32LE(4);
    if (machine !== (arch === 'x64' ? 0x01000007 : 0x0100000c)) throw new Error('TUI Mach-O target machine disagrees with target triple.');
    return { format: 'Mach-O64', arch, machine };
  }
  throw new Error('Unsupported executable platform.');
};
