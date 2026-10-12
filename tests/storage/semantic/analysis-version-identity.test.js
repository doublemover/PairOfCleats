import assert from 'node:assert/strict';
import { SEMANTIC_ANALYSIS_VERSIONS, semanticAnalysisPolicyIdentity } from '../../../src/index/semantic/analysis-versions.js';
import { semanticPolicyIdentities } from '../../../src/index/semantic/policy.js';
import { planSemanticSource } from '../../../src/index/semantic/planning.js';
import { createSemanticCacheDependencySignatures } from '../../../src/index/build/incremental/semantic-cache-dependencies.js';
import { readFileCompletion } from '../../../src/index/build/incremental/file-completion.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';

const fixture = await createSemanticCacheFixture();
try {
  const policy = fixture.policy, identities = semanticPolicyIdentities(policy);
  const bumped = semanticAnalysisPolicyIdentity(policy, { ...SEMANTIC_ANALYSIS_VERSIONS, cfgFlow: 'next' });
  assert.notEqual(bumped, identities.analysis, 'producer upgrades invalidate derived analysis even with identical settings');
  const resourceChange = { ...policy, storage: { ...policy.storage, batchRows: 32 },
    planning: { ...policy.planning, inlineBudgetMs: 1 } };
  assert.equal(semanticPolicyIdentities(resourceChange).analysis, identities.analysis);
  const changed = { ...policy, overrides: [{ match: { path: '**/*.js' }, set: { enrichment: { localFlow: 'off' } } }] };
  const signatures = createSemanticCacheDependencySignatures({ dependencySignatures: fixture.dependencySignatures,
    policy: changed, root: fixture.repoRoot });
  assert.equal(signatures.semantic, fixture.dependencies.semantic, 'analysis override changes preserve syntax extraction');
  assert.notEqual(signatures.semanticAnalysis, fixture.dependencies.semanticAnalysis);
  assert.equal(planSemanticSource(policy, { sourceUnitId: 'fixture', sourceHash: 'hash' }).policyHash, identities.analysis);
  const syntax = await fixture.createFile({ file: 'syntax.js' });
  const derived = await fixture.createFile({ file: 'derived.js', analysisReason: 'fixture-deferred-analysis' });
  const semanticContext = { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot,
    dependencySignatures: { ...fixture.dependencies, semanticAnalysis: bumped } };
  const read = result => readFileCompletion({ bundleDir: fixture.bundleDir, relKey: result.file,
    sourceBytes: result.bytes, semanticContext });
  assert.ok(await read(syntax), 'syntax-only completions survive a producer upgrade');
  assert.equal(await read(derived), null, 'context-free derived coverage must not bypass producer invalidation');
  console.log('Producer versions, override identities and syntax-only completion reuse passed');
} finally { await fixture.cleanup(); }
