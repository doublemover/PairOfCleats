import fs from 'node:fs/promises';
import path from 'node:path';

const paths = [];
for (const [key, name] of [['npm_config_cache', 'download-cache.bin'], ['TMPDIR', 'owned-scratch.bin']]) {
  if (!process.env[key]) throw new Error(`Missing declared child write location: ${key}`);
  const file = path.join(process.env[key], name);
  await fs.writeFile(file, 'fixture-child-write');
  paths.push(file);
}
console.log(JSON.stringify({ paths }));
