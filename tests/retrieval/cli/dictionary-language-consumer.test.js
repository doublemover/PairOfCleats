import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { search } from '../../../src/integrations/core/search.js';
import { runSearchCli } from '../../../src/retrieval/cli.js';
import { createQueryPlanCache } from '../../../src/retrieval/query-plan-cache.js';
import { loadDictionary } from '../../../src/retrieval/cli-dictionary.js';
import { resolveRuntimeDictionaries } from '../../../src/index/build/runtime/dictionaries.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { getDictConfig, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';

const selectedCase = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/cli/dictionary-language-consumer/')[1];
assert.ok(['disabled', 'javascript', 'default', 'alias', 'identity-partitions'].includes(selectedCase));
const { dir } = await prepareIsolatedTestCacheDir(`query-code-dictionary-${selectedCase}`);
const repo = path.join(dir, 'repo'), dictDir = path.join(dir, 'dictionaries');
await fs.mkdir(repo); await fs.mkdir(path.join(dictDir, 'code-dicts'), { recursive: true });
await fs.writeFile(path.join(dictDir, 'combined.txt'), '');
await fs.writeFile(path.join(dictDir, 'code-dicts/common-code.txt'), '');
const jsDict = path.join(dictDir, 'code-dicts/javascript.txt'), tsDict = path.join(dictDir, 'code-dicts/typescript.txt');
await fs.writeFile(jsDict, 'http\nrequest\n');
await fs.writeFile(tsDict, selectedCase === 'identity-partitions' ? 'foo\nbar\n' : 'http\nrequest\n');
const selected = selectedCase === 'disabled' ? [] : selectedCase === 'javascript' ? ['javascript']
  : selectedCase === 'alias' ? ['JS'] : selectedCase === 'identity-partitions' ? ['javascript', 'typescript'] : undefined;
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: {
  dictionary: { dir: dictDir, languages: [], files: [], includeSlang: false, enableRepoDictionary: false,
    segmentation: 'dp', dpMaxTokenLength: 32 }, indexing: selected === undefined ? {} : { codeDictLanguages: selected }
} });
try {
  const config = loadUserConfig(repo);
  const runtime = await resolveRuntimeDictionaries({ root: repo, userConfig: config,
    workerPoolConfig: { enabled: false }, daemonSession: null, log() {}, logInit() {} });
  const tokenContext = createTokenizationContext({ dictWords: runtime.dictWords, dictConfig: runtime.dictConfig,
    codeDictWords: runtime.codeDictCommonWords, codeDictWordsByLanguage: runtime.codeDictWordsByLanguage,
    codeDictLanguages: runtime.codeDictLanguages, postingsConfig: {} });
  for (const mode of ['code', 'prose']) {
    const indexDir = await createCompatibilityIndex(repo, { mode, published: true, buildId: 'dictionary-source',
      compatibilityKey: 'dictionary-compatible' });
    const entries = mode === 'code' ? [['typescript', '.ts'], ['javascript', '.js'], ['go', '.go']] : [['markdown', '.md']];
    const rows = entries.map(([lang, ext], id) => {
      const tokens = tokenizeChunkText({ text: 'httprequest', mode, ext, languageId: lang, context: tokenContext }).tokens;
      const split = mode === 'code' && runtime.codeDictLanguages.has(lang)
        && !(selectedCase === 'identity-partitions' && lang === 'typescript');
      // Prose retains the surface term and its stem, including equal values.
      const expected = mode === 'prose' ? ['httprequest', 'httprequest']
        : split ? ['http', 'request'] : ['httprequest'];
      assert.deepEqual(tokens, expected, `${mode}/${lang}: independently expected index representation`);
      return { id, file: `${lang}${ext}`, lang, ext, name: lang, chunkUid: `dictionary:${mode}:${lang}`,
        kind: 'FunctionDeclaration', start: 0, end: 11, tokens,
        metaV2: { schemaVersion: META_V2_SCHEMA_VERSION, lang } };
    });
    const vocab = [...new Set(rows.flatMap(row => row.tokens))].sort();
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(rows));
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({ vocab,
      postings: vocab.map(token => rows.filter(row => row.tokens.includes(token)).map(row => [row.id, 1])),
      docLengths: rows.map(row => row.tokens.length), totalDocs: rows.length,
      avgDocLen: rows.reduce((sum, row) => sum + row.tokens.length, 0) / rows.length }));
  }
  for (const temperature of ['cold', 'warm']) {
    const all = await search(repo, { query: 'httprequest', args: ['--mode', 'both', '--backend', 'memory', '--no-ann'] });
    assert.deepEqual(all.code.map(row => row.name).sort(), ['go', 'javascript', 'typescript'], `${temperature}: mixed dictionary policies retain all independent hits`);
    assert.deepEqual(all.prose.map(row => row.name), ['markdown'], `${temperature}: code dictionaries cannot hide unsplit prose`);
    for (const [alias, name] of [['js', 'javascript'], ['ts', 'typescript'], ['golang', 'go']]) {
      const result = await search(repo, { query: 'httprequest', args: ['--mode', 'code', '--backend', 'memory', '--no-ann', '--lang', alias] });
      assert.deepEqual(result.code.map(row => row.name), [name], `${temperature}/${alias}`);
    }
  }
  if (selectedCase === 'identity-partitions') {
    const dictConfig = getDictConfig(repo, config);
    const first = await loadDictionary(repo, dictConfig, { includeCode: true, codeDictLanguages: ['javascript', 'typescript'] });
    const cache = createQueryPlanCache(); let sets = 0; const set = cache.set.bind(cache);
    cache.set = (...args) => { sets++; return set(...args); };
    const run = () => runSearchCli(['absentpolicysentinel', '--repo', repo, '--mode', 'code', '--backend', 'memory', '--no-ann'],
      { root: repo, emitOutput: false, exitOnError: false, queryPlanCache: cache });
    assert.deepEqual((await run()).code, []); await run(); assert.equal(sets, 1);
    await fs.writeFile(jsDict, 'http\nfoo\n'); await fs.writeFile(tsDict, 'request\nbar\n');
    const second = await loadDictionary(repo, dictConfig, { includeCode: true, codeDictLanguages: ['javascript', 'typescript'] });
    assert.deepEqual([...second.dict].sort(), [...first.dict].sort(), 'the union remains deliberately identical');
    assert.notEqual(second.policyIdentity, first.policyIdentity, 'language partitions are part of tokenizer meaning');
    assert.deepEqual((await run()).code, []); assert.equal(sets, 2, 'a warm real query plan cannot reuse old language partitions');
    await run(); assert.equal(sets, 2, 'unchanged new policy still reuses its healthy plan');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`Actual ${selectedCase} dictionary producer and sparse search retain mixed language/prose membership and cache meaning.`);
