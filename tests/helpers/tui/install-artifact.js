/** Synthetic headers for installer admission tests, never native launch proof. */
export const createTuiArtifactBytes = (target, marker = 'fixture') => {
  const bytes = Buffer.alloc(512);
  if (target.platform === 'windows') {
    bytes.writeUInt16LE(0x5a4d, 0);
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes.writeUInt32LE(0x4550, 0x80);
    bytes.writeUInt16LE(target.triple.startsWith('aarch64-') ? 0xaa64 : 0x8664, 0x84);
  } else if (target.platform === 'linux') {
    bytes.writeUInt32BE(0x7f454c46, 0); bytes[4] = 2; bytes[5] = 1;
    bytes.writeUInt16LE(target.triple.startsWith('aarch64-') ? 183 : 62, 18);
  } else {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(target.triple.startsWith('aarch64-') ? 0x0100000c : 0x01000007, 4);
  }
  bytes.write(marker, 256, 128, 'utf8');
  return bytes;
};
