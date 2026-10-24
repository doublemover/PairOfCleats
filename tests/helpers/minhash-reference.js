// Independent, deliberately unfactored BigInt reference for the versioned family.
// Masking after multiplication supplies u32 arithmetic without Math.imul.
const mask = 0xffffffffn;
const mix = (input) => {
  let value = BigInt(Number(input) >>> 0);
  value = ((value ^ (value >> 16n)) * 0x85ebca6bn) & mask;
  value = ((value ^ (value >> 13n)) * 0xc2b2ae35n) & mask;
  return Number((value ^ (value >> 16n)) & mask);
};

export const referenceMinhash = (text, seed) => {
  let value = 0x811c9dc5n;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    for (const byte of [unit & 255, (unit >>> 8) & 255]) {
      value = ((value ^ BigInt(byte)) * 0x01000193n) & mask;
    }
  }
  return mix(Number(value) ^ mix(seed));
};
