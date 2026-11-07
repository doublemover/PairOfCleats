export const GENERATED_ARTIFACT_PREFIX_BYTES = 8192;
export const GENERATED_ARTIFACT_POLICY_VERSION = 'poc.generated-discovery@7';
const observations = new WeakSet();

/** Caller owns the bytes and same-read source extent. This is an omission
 * convention observation, never authentication or authority over other paths. */
export const createGeneratedArtifactPrefixObservation = ({ bytes, sourceBytes }) => {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Generated prefix bytes must be a Buffer.');
  if (typeof sourceBytes === 'number' && Number.isSafeInteger(sourceBytes) && sourceBytes >= 0) sourceBytes = BigInt(sourceBytes);
  if (typeof sourceBytes !== 'bigint' || sourceBytes < 0n || BigInt(bytes.length) > sourceBytes) throw new TypeError('Invalid generated prefix source extent.');
  const cap = BigInt(GENERATED_ARTIFACT_PREFIX_BYTES), extent = Number(sourceBytes < cap ? sourceBytes : cap);
  if (bytes.length < extent) throw new TypeError('Generated prefix read did not cover its admitted extent.');
  const prefix = Buffer.from(bytes.subarray(0, extent)), complete = sourceBytes <= cap;
  let text = null;
  try {
    // A valid unfinished UTF-8 scalar is an unknown non-ASCII character. Retain
    // that lexical fact, including rejection after a JSON escape introducer.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    text = decoder.decode(prefix, { stream: !complete });
    if (!complete && Buffer.byteLength(text, 'utf8') < prefix.length) text += '\ufffd';
  } catch { /* Visible invalid UTF-8 cannot qualify an owned JSON artifact. */ }
  const result = Object.freeze({ bytes: prefix, sourceBytes, complete, text });
  observations.add(result); return result;
};

export const isGeneratedArtifactPrefixObservation = value => observations.has(value);

/** Raw classifier inputs mean the complete already-available source, not an
 * unknown capped read. Partial readers must provide the explicit observation. */
export const resolveGeneratedArtifactPrefixObservation = source => {
  if (observations.has(source)) return source;
  try {
    if (Buffer.isBuffer(source)) return createGeneratedArtifactPrefixObservation({ bytes: source, sourceBytes: source.length });
    // Keep legacy small string fixtures bounded. Larger strings require their
    // byte owner; never scan or encode an unbounded caller string here.
    if (typeof source === 'string' && source.length <= GENERATED_ARTIFACT_PREFIX_BYTES) {
      const bytes = Buffer.from(source);
      return createGeneratedArtifactPrefixObservation({ bytes, sourceBytes: bytes.length });
    }
  } catch { /* Unknown extent/content stays an ordinary source input. */ }
  return null;
};
