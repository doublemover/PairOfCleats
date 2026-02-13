import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateUsrLanguageBatchShards } from '../../../src/contracts/validators/usr-matrix.js';
import { splitNormalizedLines } from '../../../src/shared/eol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const languageProfilesPath = path.join(matrixDir, 'usr-language-profiles.json');
const languageShardsPath = path.join(matrixDir, 'usr-language-batch-shards.json');

const readOrderManifest = (orderManifestPath) => {
  const text = fs.readFileSync(orderManifestPath, 'utf8');
  return splitNormalizedLines(text)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

export const assertLanguageShardDefinition = ({ shardId, laneId, expectedOrderIds, expectedOrderManifest }) => {
  const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
  const languageShards = JSON.parse(fs.readFileSync(languageShardsPath, 'utf8'));

  const validation = validateUsrLanguageBatchShards({
    batchShardsPayload: languageShards,
    languageProfilesPayload: languageProfiles
  });
  assert.equal(validation.ok, true, `language shard matrix validation failed: ${validation.errors.join('; ')}`);

  const row = (languageShards.rows || []).find((entry) => entry.id === shardId);
  assert.ok(row, `missing language shard row ${shardId}`);
  assert.equal(row.laneId, laneId, `language shard lane mismatch for ${shardId}`);

  assert.equal(row.orderManifest, expectedOrderManifest, `language shard order manifest mismatch for ${shardId}`);

  const orderManifestPath = path.join(repoRoot, row.orderManifest.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(orderManifestPath), true, `missing order manifest: ${row.orderManifest}`);

  const manifestIds = readOrderManifest(orderManifestPath);
  assert.deepEqual(manifestIds, expectedOrderIds, `unexpected deterministic order entries for ${shardId}`);

  const sortedIds = [...manifestIds].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(manifestIds, sortedIds, `order manifest entries must be sorted for deterministic execution (${shardId})`);
};
