// Synthetic structure only. This is deliberately not native capture evidence.
export const createWindowsMinidumpFixture = ({ pid = 1234, exceptionCode = 0xc0000005 } = {}) => {
  const buffer = Buffer.alloc(640);
  buffer.writeUInt32LE(0x504d444d, 0); buffer.writeUInt32LE(0xa793, 4);
  buffer.writeUInt32LE(4, 8); buffer.writeUInt32LE(32, 12);
  const entry = (index, type, rva, size) => {
    const at = 32 + index * 12;
    buffer.writeUInt32LE(type, at); buffer.writeUInt32LE(size, at + 4); buffer.writeUInt32LE(rva, at + 8);
  };
  entry(0, 15, 80, 24); entry(1, 6, 104, 168); entry(2, 3, 272, 52); entry(3, 4, 324, 112);
  buffer.writeUInt32LE(24, 80); buffer.writeUInt32LE(1, 84); buffer.writeUInt32LE(pid, 88);
  buffer.writeUInt32LE(77, 104); buffer.writeUInt32LE(exceptionCode, 112);
  buffer.writeBigUInt64LE(0x12345678n, 128); buffer.writeUInt32LE(2, 136);
  buffer.writeBigUInt64LE(1n, 144); buffer.writeBigUInt64LE(0xfeedn, 152);
  buffer.writeUInt32LE(16, 264); buffer.writeUInt32LE(440, 268);
  buffer.writeUInt32LE(1, 272); buffer.writeUInt32LE(77, 276);
  buffer.writeUInt32LE(8, 308); buffer.writeUInt32LE(456, 312);
  buffer.writeUInt32LE(16, 316); buffer.writeUInt32LE(440, 320);
  buffer.writeUInt32LE(1, 324); buffer.writeBigUInt64LE(0x10000000n, 328);
  buffer.writeUInt32LE(4096, 336); buffer.writeUInt32LE(464, 348);
  buffer.writeUInt32LE(36, 404); buffer.writeUInt32LE(544, 408);
  const name = Buffer.from('C:\\owned\\fixture.node', 'utf16le');
  buffer.writeUInt32LE(name.length, 464); name.copy(buffer, 468);
  buffer.write('RSDS', 544, 'ascii'); buffer.fill(0xaa, 548, 564);
  buffer.writeUInt32LE(2, 564); buffer.write('fixture.pdb\0', 568, 'utf8');
  return buffer;
};
