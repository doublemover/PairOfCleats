#!/usr/bin/env node
import { runImpactCli } from '../../src/integrations/tooling/impact.js';

runImpactCli()
  .then((result) => {
    if (result?.ok === false) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
