import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');

const createConfig = async (tempRoot) => {
  const configPath = path.join(tempRoot, 'service-config.json');
  await fsPromises.writeFile(configPath, JSON.stringify({
    queueDir: path.join(tempRoot, 'queue'),
    repos: []
  }, null, 2), 'utf8');
  return configPath;
};

export const runServiceIndexerJson = async ({
  testCacheDir,
  subcommand
}) => {
  if (!fs.existsSync(binPath)) {
    throw new Error(`Missing CLI entrypoint: ${binPath}`);
  }
  const resolvedSubcommand = typeof subcommand === 'string' && subcommand.trim()
    ? subcommand.trim()
    : 'status';
  const tempRoot = path.join(root, '.testCache', testCacheDir);
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });
  const configPath = await createConfig(tempRoot);

  const args = [binPath, 'service', 'indexer', resolvedSubcommand, '--json', '--config', configPath];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const context = /INVALID_REQUEST/i.test(stderr)
      ? `top-level CLI rejected --json (${resolvedSubcommand})`
      : `non-zero exit (${resolvedSubcommand})`;
    throw new Error(`${context}${stderr ? `: ${stderr}` : ''}`);
  }
  const stdout = String(result.stdout || '').trim();
  if (!stdout) {
    throw new Error(`expected JSON output (${resolvedSubcommand})`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`invalid JSON output (${resolvedSubcommand}): ${error?.message || error}`);
  }
};
