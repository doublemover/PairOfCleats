import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

export const writeJsonl = async (items, outPath = null) => {
  const stream = outPath
    ? fs.createWriteStream(outPath, { encoding: 'utf8' })
    : process.stdout;
  for (const item of items) {
    const line = JSON.stringify(item);
    if (!stream.write(`${line}\n`)) {
      await new Promise((resolve) => stream.once('drain', resolve));
    }
  }
  if (outPath) {
    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.end(resolve);
    });
  }
};

export const writeJson = async (items, outPath = null) => {
  const payload = JSON.stringify({ results: items }, null, 2);
  if (outPath) {
    await fsPromises.writeFile(outPath, payload);
  } else {
    console.log(payload);
  }
};
