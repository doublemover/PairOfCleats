import fs from 'node:fs/promises';
import path from 'node:path';

export const parseLexiconCliArgs = (argv, {
  defaults,
  usage,
  includeSchema = false
}) => {
  const out = { ...(defaults || {}) };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--dir') {
      out.dir = path.resolve(argv[i + 1] || out.dir);
      i += 1;
      continue;
    }
    if (includeSchema && arg === '--schema') {
      out.schema = path.resolve(argv[i + 1] || out.schema);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${arg}`);
  }
  return out;
};

export const listWordlistJsonFiles = async (dir) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new Error(`Failed to read wordlist directory: ${error?.message || error}`);
  }
};

