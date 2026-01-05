import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

export const writeJsonl = (items, outPath = null) => {
  const payload = items.map((item) => JSON.stringify(item)).join('\n');
  if (outPath) {
    fs.writeFileSync(outPath, `${payload}${payload ? '\n' : ''}`, 'utf8');
  } else {
    process.stdout.write(`${payload}${payload ? '\n' : ''}`);
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
