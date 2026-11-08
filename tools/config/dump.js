#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { formatEffectiveConfiguration } from './effective.js';
import { buildConfigurationDump } from './dump-payload.js';
import { CONFIG_DUMP_OPTIONS } from './options.js';
import {
  resolveRepoRootArg,
  resolveRepoConfigPath
} from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'pairofcleats config dump',
  options: CONFIG_DUMP_OPTIONS
}).parse();

const repoRoot = resolveRepoRootArg(argv.repo);
const payload = await buildConfigurationDump({ repoRoot,
  configPath: argv.config ? resolveRepoConfigPath(repoRoot, argv.config) : null, includeCapabilities: argv.capabilities === true });

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.error(formatEffectiveConfiguration(payload));
  if (payload.ok) {
    console.error('Configuration preview (not a live-run receipt)');
    console.error(`- cache root: ${payload.derived.cacheRoot}`);
    console.error(`- repo cache: ${payload.derived.repoCacheRoot}`);
    console.error(`- mcp mode: ${payload.derived.mcp.mode} (${payload.derived.mcp.modeSource})`);
    if (argv.capabilities) console.error(`- mcp sdk: ${payload.derived.mcp.sdkAvailable ? 'available' : 'missing'}`);
  }
}
process.exitCode = payload.ok ? 0 : 1;
