import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { runNode } from './run-node.js';
import { prepareTestCacheDir } from './test-cache.js';

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
  const { dir: tempRoot } = await prepareTestCacheDir(testCacheDir);
  const configPath = await createConfig(tempRoot);

  const args = [binPath, 'service', 'indexer', resolvedSubcommand, '--json', '--config', configPath];
  const result = runNode(args, `service indexer ${resolvedSubcommand} --json`, root, process.env, {
    stdio: 'pipe',
    encoding: 'utf8',
    onFailure: (failed) => {
      const stderr = String(failed?.stderr || '').trim();
      const context = /INVALID_REQUEST/i.test(stderr)
        ? `top-level CLI rejected --json (${resolvedSubcommand})`
        : `non-zero exit (${resolvedSubcommand})`;
      if (stderr) {
        console.error(`${context}: ${stderr}`);
      } else {
        console.error(context);
      }
    }
  });
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
