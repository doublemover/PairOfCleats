import assert from 'node:assert/strict';
import { OpenAIEmbeddingFunction } from '@lancedb/lancedb/embedding/openai';
import { getRegistry } from '@lancedb/lancedb/embedding';

const originalFetch = globalThis.fetch;
const requests = [];
const vector = Array.from({ length: 1536 }, (_, i) => i / 1536);
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(request.url, 'https://api.openai.com/v1/embeddings');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('authorization'), 'Bearer fixture-no-network');
  const body = await request.json(); requests.push(body);
  assert.equal(body.model, 'text-embedding-3-small');
  if (body.input === 'fixture rejection') return Response.json({ error: {
    message: 'fixture invalid request', type: 'invalid_request_error', code: 'fixture_invalid'
  } }, { status: 400 });
  const rows = Array.isArray(body.input) ? body.input : [body.input];
  return Response.json({ object: 'list', model: body.model, data: rows.map((_, index) => ({
    object: 'embedding', index, embedding: vector
  })), usage: { prompt_tokens: rows.length, total_tokens: rows.length } });
};
try {
  assert.throws(() => new OpenAIEmbeddingFunction({ apiKey: 'raw-fixture-key' }), /sensitive and cannot be set directly/);
  assert.throws(() => new OpenAIEmbeddingFunction({ apiKey: '$var:poc-missing-sdk-key' }), /Variable .+ not found/);
  const registry = getRegistry(); registry.setVar('poc-sdk-fixture-key', 'fixture-no-network');
  const embedding = new OpenAIEmbeddingFunction({ apiKey: '$var:poc-sdk-fixture-key', model: 'text-embedding-3-small' });
  assert.equal(embedding.ndims(), 1536);
  assert.deepEqual(embedding.getSensitiveKeys(), ['apiKey']);
  assert.equal(embedding.toJSON().apiKey, '$var:poc-sdk-fixture-key');
  assert.deepEqual(await embedding.computeSourceEmbeddings(['first', 'second']), [vector, vector]);
  assert.deepEqual(await embedding.computeQueryEmbeddings('query'), vector);
  assert.deepEqual(requests.map(body => body.input), [['first', 'second'], 'query']);
  await assert.rejects(embedding.computeQueryEmbeddings(42), /Data must be a string/);
  assert.equal(requests.length, 2, 'invalid input must not reach the SDK transport');
  await assert.rejects(embedding.computeQueryEmbeddings('fixture rejection'), error =>
    error.status === 400 && error.code === 'fixture_invalid');
  assert.equal(requests.length, 3, 'a non-retryable API rejection must propagate once');
} finally { globalThis.fetch = originalFetch; }
console.log('LanceDB optional OpenAI adapter preserves request, vector, secret-key and error contracts using the current SDK; no network sent');
