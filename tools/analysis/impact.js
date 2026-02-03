#!/usr/bin/env node
import { runImpactCli } from '../../src/integrations/tooling/impact.js';

runImpactCli().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
