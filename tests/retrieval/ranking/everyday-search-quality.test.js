import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIndex } from '../../../src/integrations/core/build-index.js';
import { search } from '../../../src/integrations/core/search.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-search-quality-'));
const repo = path.join(temporary, 'repo');
applyTestEnv({ cacheRoot: path.join(temporary, 'cache'), embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }, sqlite: { use: false }
} });
const files = {
  'billing.js': '/** Refund a captured payment after checking its currency. */\nexport function refundPayment(payment, currency) { if (payment.currency !== currency) throw new Error("currency mismatch"); return { refunded: payment.amount }; }\n',
  'auth.js': '/** Reject an expired session token before authenticating a request. */\nexport function validateSession(token, now) { return token.expiresAt > now; }\n',
  'integrity.js': 'import { createHash } from "node:crypto";\n/** Compute a SHA256 checksum for downloaded content. */\nexport function checksum(content) { return createHash("sha256").update(content).digest("hex"); }\n',
  'retry.js': '/** Retry a failed request using exponential backoff. */\nexport function retryDelay(attempt) { return Math.min(5000, 100 * 2 ** attempt); }\n',
  'api.js': 'import { refundPayment } from "./billing.js";\nexport function refundRoute(payment) { return refundPayment(payment, "USD"); }\n',
  'billing.test.js': 'import { refundPayment } from "./billing.js";\nexport function testRefund() { return refundPayment({ currency: "USD", amount: 20 }, "USD"); }\n',
  'mapping.js': '/** Map a refund status label for display without changing the payment. */\nexport function refundLabel(status) { return status === "paid" ? "Refund available" : "Pending"; }\n',
  'tokenizer.js': '/** Split source tokens for search indexing. */\nexport function tokenizeSource(source) { return source.split(/\\s+/); }\n'
};
const cases = [
  { query: 'refundPayment', file: 'billing.js', rank: 1 },
  { query: 'validateSession', file: 'auth.js', rank: 1 },
  { query: 'retryDelay', file: 'retry.js', rank: 1 },
  { query: 'refund payment', file: 'billing.js', rank: 3 },
  { query: '"expired session"', mode: 'extracted-prose', file: 'auth.js', rank: 1 },
  { query: 'sha256 checksum', file: 'integrity.js', rank: 1 },
  { query: 'exponential backoff', mode: 'extracted-prose', file: 'retry.js', rank: 1 },
  { query: 'source tokens', mode: 'extracted-prose', file: 'tokenizer.js', rank: 1 },
  { query: 'currency mismatch', file: 'billing.js', rank: 1 },
  { query: 'testRefund', file: 'billing.test.js', rank: 1 }
];
try {
  await fs.mkdir(repo);
  for (const [file, source] of Object.entries(files)) await fs.writeFile(path.join(repo, file), source);
  await buildIndex(repo, { modes: ['code', 'extracted-prose'], stage: 'stage2', threads: 1, log: () => {} });
  const receipts = [];
  for (const item of cases) {
    const result = await search(repo, { query: item.query, mode: item.mode || 'code', backend: 'memory', top: 5 });
    const hits = result[item.mode === 'extracted-prose' ? 'extractedProse' : 'code'];
    const rank = hits.findIndex(hit => hit.file === item.file) + 1;
    receipts.push({ query: item.query, expected: item.file, rank, files: hits.map(hit => hit.file) });
    assert.ok(rank > 0 && rank <= item.rank, JSON.stringify(receipts.at(-1)));
  }
  console.log(JSON.stringify({ scope: 'real lexical index, 8-file application fixture', queries: receipts,
    mrr: receipts.reduce((sum, row) => sum + 1 / row.rank, 0) / receipts.length }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
