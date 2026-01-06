import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { Gzip } from 'fflate';

const writeChunk = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
};

const waitForFinish = (stream) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.on('finish', resolve);
});

const createTempPath = (filePath) => (
  `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
);

const createFflateGzipStream = (options = {}) => {
  const level = Number.isFinite(Number(options.level)) ? Math.floor(Number(options.level)) : 6;
  const gzip = new Gzip({ level });
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      try {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
        gzip.push(buffer, false);
        callback();
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      try {
        gzip.push(new Uint8Array(0), true);
        callback();
      } catch (err) {
        callback(err);
      }
    }
  });
  gzip.ondata = (chunk) => {
    if (chunk && chunk.length) {
      stream.push(Buffer.from(chunk));
    }
  };
  return stream;
};

const getBakPath = (filePath) => `${filePath}.bak`;

const replaceFile = async (tempPath, finalPath) => {
  const bakPath = getBakPath(finalPath);
  const finalExists = fs.existsSync(finalPath);
  let backupAvailable = fs.existsSync(bakPath);
  const copyFallback = async () => {
    try {
      await fsPromises.copyFile(tempPath, finalPath);
      await fsPromises.rm(tempPath, { force: true });
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      await fsPromises.rename(finalPath, bakPath);
      backupAvailable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fs.existsSync(bakPath);
      }
    }
  }
  try {
    await fsPromises.rename(tempPath, finalPath);
  } catch (err) {
    if (err?.code !== 'EEXIST'
      && err?.code !== 'EPERM'
      && err?.code !== 'ENOTEMPTY'
      && err?.code !== 'EACCES'
      && err?.code !== 'EXDEV') {
      throw err;
    }
    if (!backupAvailable) {
      if (await copyFallback()) return;
      throw err;
    }
    try {
      await fsPromises.rm(finalPath, { force: true });
    } catch {}
    try {
      await fsPromises.rename(tempPath, finalPath);
    } catch (renameErr) {
      if (await copyFallback()) return;
      throw renameErr;
    }
  }
};

const createJsonWriteStream = (filePath, options = {}) => {
  const { compression = null, atomic = false } = options;
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const fileStream = fs.createWriteStream(targetPath);
  if (compression === 'gzip') {
    const gzip = createFflateGzipStream();
    gzip.pipe(fileStream);
    return {
      stream: gzip,
      done: Promise.all([waitForFinish(gzip), waitForFinish(fileStream)])
        .then(async () => {
          if (atomic) {
            await replaceFile(targetPath, filePath);
          }
        })
        .catch(async (err) => {
          if (atomic) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
          }
          throw err;
        })
    };
  }
  return {
    stream: fileStream,
    done: waitForFinish(fileStream)
      .then(async () => {
        if (atomic) {
          await replaceFile(targetPath, filePath);
        }
      })
      .catch(async (err) => {
        if (atomic) {
          try { await fsPromises.rm(targetPath, { force: true }); } catch {}
        }
        throw err;
      })
  };
};

const writeArrayItems = async (stream, items) => {
  let first = true;
  for (const item of items) {
    const json = JSON.stringify(item === undefined ? null : item);
    await writeChunk(stream, `${first ? '' : ','}${json}`);
    first = false;
  }
};

/**
 * Stream JSON lines to disk (one JSON object per line).
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonLinesFile(filePath, items, options = {}) {
  const { compression = null, atomic = false } = options;
  const { stream, done } = createJsonWriteStream(filePath, { compression, atomic });
  for (const item of items) {
    const json = JSON.stringify(item === undefined ? null : item);
    await writeChunk(stream, `${json}\n`);
  }
  stream.end();
  await done;
}

/**
 * Stream a JSON array to disk without holding the full string in memory.       
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonArrayFile(filePath, items, options = {}) {
  const { trailingNewline = true, compression = null, atomic = false } = options;
  const { stream, done } = createJsonWriteStream(filePath, { compression, atomic });
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
  const {
    fields = {},
    arrays = {},
    trailingNewline = true,
    compression = null,
    atomic = false
  } = input;
  const { stream, done } = createJsonWriteStream(filePath, { compression, atomic });
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
