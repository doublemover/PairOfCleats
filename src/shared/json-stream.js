import fs from 'node:fs';
import { once } from 'node:events';

const writeChunk = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
};

const waitForFinish = (stream) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.on('finish', resolve);
});

const writeArrayItems = async (stream, items) => {
  let first = true;
  for (const item of items) {
    const json = JSON.stringify(item === undefined ? null : item);
    await writeChunk(stream, `${first ? '' : ','}${json}`);
    first = false;
  }
};

/**
 * Stream a JSON array to disk without holding the full string in memory.
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonArrayFile(filePath, items, options = {}) {
  const { trailingNewline = true } = options;
  const stream = fs.createWriteStream(filePath);
  const done = waitForFinish(stream);
  await writeChunk(stream, '[');
  await writeArrayItems(stream, items);
  await writeChunk(stream, ']');
  if (trailingNewline) await writeChunk(stream, '\n');
  stream.end();
  await done;
}

/**
 * Stream a JSON object with one or more array fields to disk.
 * @param {string} filePath
 * @param {{fields?:object,arrays?:object,trailingNewline?:boolean}} input
 * @returns {Promise<void>}
 */
export async function writeJsonObjectFile(filePath, input = {}) {
  const { fields = {}, arrays = {}, trailingNewline = true } = input;
  const stream = fs.createWriteStream(filePath);
  const done = waitForFinish(stream);
  await writeChunk(stream, '{');
  let first = true;
  for (const [key, value] of Object.entries(fields)) {
    const entry = `${JSON.stringify(key)}:${JSON.stringify(value)}`;
    await writeChunk(stream, `${first ? '' : ','}${entry}`);
    first = false;
  }
  for (const [key, items] of Object.entries(arrays)) {
    const header = `${JSON.stringify(key)}:[`;
    await writeChunk(stream, `${first ? '' : ','}${header}`);
    first = false;
    await writeArrayItems(stream, items);
    await writeChunk(stream, ']');
  }
  await writeChunk(stream, '}');
  if (trailingNewline) await writeChunk(stream, '\n');
  stream.end();
  await done;
}
