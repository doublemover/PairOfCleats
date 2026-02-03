#!/usr/bin/env node
import { runSuggestTestsCli } from '../../src/integrations/tooling/suggest-tests.js';

runSuggestTestsCli().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
