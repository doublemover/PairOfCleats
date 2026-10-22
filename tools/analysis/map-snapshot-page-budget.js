/** Count each candidate's JSON-array representation once. The response owner
 * still serializes/checks the final envelope before publication. */
export const createSnapshotRowByteBudget = ({ maxResponseBytes, emptyEnvelope }) => {
  const envelopeBytes = envelope => {
    if (!Array.isArray(envelope.rows) || envelope.rows.length) throw new TypeError('Snapshot row budget requires an empty rows envelope.');
    return Buffer.byteLength(JSON.stringify(envelope));
  };
  const fixedBytes = envelopeBytes(emptyEnvelope);
  let rowBytes = 0, count = 0;
  return {
    admit(row, nextEmptyEnvelope = null) {
      // Array serialization preserves null for an undefined array element and
      // includes JSON escaping and actual UTF-8 bytes rather than UTF-16 size.
      const candidateBytes = Buffer.byteLength(JSON.stringify([row])) - 2;
      const nextRowsBytes = rowBytes + candidateBytes + (count ? 1 : 0);
      if ((nextEmptyEnvelope ? envelopeBytes(nextEmptyEnvelope) : fixedBytes) + nextRowsBytes > maxResponseBytes) return false;
      rowBytes = nextRowsBytes; count++;
      return true;
    }
  };
};
