import fs from 'node:fs';
import { atomicWriteText } from '../../shared/io/atomic-write.js';

export const writeJsonl = async (items, outPath = null) => {
  const stream = outPath
    ? fs.createWriteStream(outPath, { encoding: 'utf8' })
    : process.stdout;
  if (!outPath) {
    for (const item of items) {
      const line = JSON.stringify(item);
      if (!stream.write(`${line}\n`)) {
        await new Promise((resolve) => stream.once('drain', resolve));
      }
    }
    return;
  }

  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', resolve);

    (async () => {
      try {
        for (const item of items) {
          const line = JSON.stringify(item);
          if (!stream.write(`${line}\n`)) {
            await new Promise((resolveDrain) => stream.once('drain', resolveDrain));
          }
        }
        stream.end();
      } catch (err) {
        stream.destroy(err);
        reject(err);
      }
    })();
  });
};

export const writeJson = async (items, outPath = null) => {
  const payload = JSON.stringify({ results: items }, null, 2);
  if (outPath) {
    await atomicWriteText(outPath, payload, { newline: false });
  } else {
    console.log(payload);
  }
};
