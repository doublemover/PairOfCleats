import { createJsonWriteStream } from '../../shared/json-stream/streams.js';
import { abortJsonWrite } from '../../shared/json-stream/json-writers.js';

/** One atomic stream publication/retirement owner for map JSON encodings. */
export const withMapJsonPublication = async (filePath, write) => {
  const { stream, done } = createJsonWriteStream(filePath, { atomic: true });
  try { await write(stream); stream.end(); await done; }
  catch (error) { throw await abortJsonWrite(stream, done, error); }
};
