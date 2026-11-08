export const normalizeRecordSniffBytes = value => Number.isFinite(Number(value))
  ? Math.max(0, Math.floor(Number(value)))
  : 16384;

/** A bounded reader fills its request or reaches EOF; arbitrary supplied bytes
 * alone do not establish that a shorter prefix reaches EOF.
 */
export const captureRecordSamplePrefix = (buffer, requestedBytes) => ({
  bytes: buffer || Buffer.alloc(0),
  requestedBytes,
  complete: true,
  eof: (buffer?.length || 0) < requestedBytes
});

/** Admit exactly the configured byte prefix. Decode that prefix with Node's
 * UTF-8 replacement policy, including a split trailing sequence, in both paths.
 * Never read beyond the cap to complete a code point.
 */
export const sampleRecordContent = async ({ maxBytes, prefix = null, readSample }) => {
  const requestedBytes = normalizeRecordSniffBytes(maxBytes);
  let admitted = prefix;
  if (requestedBytes === 0) admitted = captureRecordSamplePrefix(null, 0);
  else if (!admitted || admitted.bytes.length < requestedBytes && !(admitted.complete && admitted.eof)) {
    admitted = captureRecordSamplePrefix(await readSample(requestedBytes), requestedBytes);
  }
  const bytes = admitted.bytes.subarray(0, requestedBytes);
  return { bytes, requestedBytes, complete: true,
    eof: admitted.complete && admitted.eof && bytes.length === admitted.bytes.length,
    text: bytes.toString('utf8') };
};
