import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createSearchLifecycle } from './search-lifecycle.js';

export const prepareSharedSearchContractFixture = async ({
  cacheName = 'shared-search-contract'
} = {}) => {
  const lifecycle = await createSearchLifecycle({
    cacheScope: 'shared',
    cacheName
  });
  const { repoRoot, buildIndex } = lifecycle;
  await fsPromises.mkdir(path.join(repoRoot, 'src', 'nested'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'answer.js'),
    [
      'export function answer(value = 42) {',
      '  return value;',
      '}',
      '',
      'export function returnValue() {',
      '  return answer();',
      '}',
      ''
    ].join('\n')
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'nested', 'util.js'),
    'export function winPathFilter() { return "windows path filter"; }\n'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'README.md'),
    '# Sample\n\nalpha bravo\nreturn value documentation\n',
    'utf8'
  );
  buildIndex({
    label: 'build shared search contract fixture',
    stage: 'stage2'
  });
  return lifecycle;
};

export const SHARED_SEARCH_CONTRACT_CASES = Object.freeze([
  {
    id: 'compact-code-top3',
    query: 'return',
    mode: 'code',
    top: 3,
    assertPayload(payload, { source }) {
      if (!payload || typeof payload !== 'object') {
        throw new Error(`${source} compact-code-top3 payload missing`);
      }
      const hits = payload.code || [];
      if (!Array.isArray(hits) || hits.length === 0) {
        throw new Error(`${source} compact-code-top3 expected code hits`);
      }
      if (hits.length > 3) {
        throw new Error(`${source} compact-code-top3 expected top <= 3, got ${hits.length}`);
      }
      if (hits[0]?.tokens !== undefined) {
        throw new Error(`${source} compact-code-top3 expected compact hits without tokens`);
      }
      if (!hits.some((hit) => String(hit.file || '').endsWith('src/answer.js'))) {
        throw new Error(`${source} compact-code-top3 expected src/answer.js hit`);
      }
    }
  }
]);
