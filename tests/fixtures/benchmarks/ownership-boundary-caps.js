import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
const routes = {
  "manifest": {
    "file": "tests/indexing/artifacts/manifest/checksum-cancellation-owner.test.js",
    "prefix": "indexing/artifacts/manifest/checksum-cancellation-owner"
  },
  "filter": {
    "file": "tests/retrieval/filters/filter-cache-original-resource-consumers.test.js",
    "prefix": "retrieval/filters/filter-cache-original-resource-consumers"
  },
  "probe": {
    "file": "tests/tooling/api-mcp/repository-probe-original-config-owner.test.js",
    "prefix": "tooling/api-mcp/repository-probe-original-config-owner"
  }
};
const [scenario, selected, destination] = process.argv.slice(2), route = routes[scenario];
assert.ok(route); assert.ok(destination && path.isAbsolute(destination));
const { cases } = JSON.parse(await fs.readFile(route.file + '.cases.json', 'utf8'));
assert.ok(cases.includes(selected));
process.env.PAIROFCLEATS_TEST_ID = route.prefix + '/' + selected;
process.argv.push('--observation', destination);
await import('../../../' + route.file);
