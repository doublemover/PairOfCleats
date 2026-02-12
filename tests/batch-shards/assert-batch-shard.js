import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateUsrLanguageBatchShards } from '../../src/contracts/validators/usr-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const languageProfilesPath = path.join(matrixDir, 'usr-language-profiles.json');
const batchShardsPath = path.join(matrixDir, 'usr-language-batch-shards.json');

const readOrderManifest = (orderManifestPath) => {
  const text = fs.readFileSync(orderManifestPath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

export const assertBatchShardLane = ({ batchId, laneId, expectedOrderIds }) => {
  const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
  const batchShards = JSON.parse(fs.readFileSync(batchShardsPath, 'utf8'));

  const validation = validateUsrLanguageBatchShards({
    batchShardsPayload: batchShards,
    languageProfilesPayload: languageProfiles
  });
  assert.equal(validation.ok, true, `batch shard matrix validation failed: ${validation.errors.join('; ')}`);

  const row = (batchShards.rows || []).find((entry) => entry.id === batchId);
  assert.ok(row, `missing batch shard row ${batchId}`);
  assert.equal(row.laneId, laneId, `batch shard lane mismatch for ${batchId}`);

  const expectedManifest = `tests/${laneId}/${laneId}.order.txt`;
  assert.equal(row.orderManifest, expectedManifest, `batch shard order manifest mismatch for ${batchId}`);

  const orderManifestPath = path.join(repoRoot, row.orderManifest.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(orderManifestPath), true, `missing order manifest: ${row.orderManifest}`);

  const manifestIds = readOrderManifest(orderManifestPath);
  assert.deepEqual(manifestIds, expectedOrderIds, `unexpected deterministic order entries for ${batchId}`);

  const sortedIds = [...manifestIds].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(manifestIds, sortedIds, `order manifest entries must be sorted for deterministic execution (${batchId})`);
};
