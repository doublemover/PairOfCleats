import fs from 'node:fs/promises';
import path from 'node:path';

// Authored consumer stand-ins exercise the spawned environment. These are not
// a qualification of vendor Python, pip, Graphviz or fontconfig behavior.
const family = process.argv[2];
const writes = family === 'python'
  ? [['PIP_CACHE_DIR', 'http-v2/download-fragment'], ['PYTHONPYCACHEPREFIX', 'project/module.cpython.pyc']]
  : family === 'graphviz' || family === 'fontconfig'
    ? [['XDG_CACHE_HOME', 'fontconfig/fixture-cache']]
    : [];
if (!writes.length) throw new Error('Select a supported fixture family.');
const paths = [];
for (const [key, relative] of [...writes, ['TMPDIR', 'run-fragment']]) {
  if (!process.env[key]) throw new Error(`Missing declared write location: ${key}`);
  const file = path.resolve(process.env[key], relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `authored ${family} consumer bytes`);
  paths.push(file);
}
console.log(JSON.stringify({ paths, env: Object.fromEntries([
  'PIP_CACHE_DIR', 'PYTHONPYCACHEPREFIX', 'XDG_CACHE_HOME', 'HOME', 'HF_HOME', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH',
  'PYTHONUSERBASE', 'ERL_CRASH_DUMP'
].map(key => [key, process.env[key] ?? null])) }));
