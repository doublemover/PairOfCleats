#!/usr/bin/env node
import { runApiContractsCli } from '../src/integrations/tooling/api-contracts.js';

runApiContractsCli().catch((err) => {
  console.error(err?.message || err);
  process.exit(err?.code === 'ERR_API_CONTRACT_WARN' ? 2 : 1);
});
