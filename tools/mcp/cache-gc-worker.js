#!/usr/bin/env node
// Internal owned child: MCP never grants whole-cache/CAS maintenance authority.
import { runCacheGc } from '../index/cache-gc.js';

await runCacheGc({ repoOnly: true });
