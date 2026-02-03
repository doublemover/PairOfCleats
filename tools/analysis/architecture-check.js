#!/usr/bin/env node
import { runArchitectureCheckCli } from '../../src/integrations/tooling/architecture-check.js';

runArchitectureCheckCli().catch((err) => {
  console.error(err?.message || err);
  process.exit(err?.code === 'ERR_ARCHITECTURE_VIOLATION' ? 2 : 1);
});
