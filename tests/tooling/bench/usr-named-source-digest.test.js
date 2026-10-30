import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashInputs,USR_SOURCE_DIGEST_VERSION,USR_SOURCE_DIGEST_FORMAT } from '../../../tools/bench/usr/shared.js';
import { createGovernanceDriftReport } from '../../../tools/bench/usr/item37-governance-drift.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const input=(role,file,value)=>({role,path:file,value});
// Independently fixed frames, SHA256 provider; constants generated from the
// published big-endian length/count format by Python hashlib/struct, not hashInputs.
const expectedEmpty='e62497d9dd4dcc27baf66a2fd89a2db7d4d3bd8e15eac0ea5fe2659b64ba8680';
const expectedMember='0cb08e6d873567f939211fa0d59bdb72b37fb35d15ad167680a57ad83884bb5e';
const expectedUnicode='4600d5ce37568a5f352685f9dfa906b0c213b071c25a1a53e5670952f9f32d85';
assert.equal(hashInputs([]),expectedEmpty);assert.equal(hashInputs([input('a','a.txt','')]),expectedMember);
assert.equal(hashInputs([input('a','a.txt','é\0')]),expectedUnicode);
const a=[input('governance','governance.md','# Governance\n'),input('coverage','coverage.md','# Coverage\nrow\n')];
const shifted=[input('governance','governance.md','# Governance\n# Coverage\n'),input('coverage','coverage.md','row\n')];
assert.notEqual(hashInputs(a),hashInputs(shifted));assert.equal(hashInputs(a),hashInputs(structuredClone(a)));
assert.notEqual(hashInputs(a),hashInputs(a.toReversed()));
assert.notEqual(hashInputs(a),hashInputs([{...a[0],role:'other'},a[1]]));
assert.notEqual(hashInputs(a),hashInputs([{...a[0],path:'other.md'},a[1]]));
assert.notEqual(hashInputs([input('a','a','x\0y'),input('b','b','z')]),hashInputs([input('a','a','x'),input('b','b','y\0z')]));
assert.notEqual(hashInputs([input('a','a','x')]),hashInputs([input('a','a','x ')]));
for(const bad of [[null],['legacy-string'],[input('a','a',{})],[input('a','a',42)]])assert.throws(()=>hashInputs(bad),TypeError);
const {dir:root}=await prepareIsolatedTestCacheDir('usr-named-source-digest');
const config={section:'fixture',item:37,inputs:{ownershipMatrix:'ownership.json',governanceSpec:'governance.md',coverageMatrix:'coverage.md'},requiredGovernanceReferences:['one']};
const configPath=path.join(root,'config.json');await fs.writeFile(configPath,JSON.stringify(config));
await fs.writeFile(path.join(root,'ownership.json'),'{"rows":[{"blocking":true},{"blocking":false}]}');
await fs.writeFile(path.join(root,'governance.md'),'# Governance\né\n');await fs.writeFile(path.join(root,'coverage.md'),'# Coverage\nrow\n');
const first=await createGovernanceDriftReport({configPath,inputRoot:root});
assert.equal(first.sourceDigestVersion,2);assert.equal(first.sourceDigestFormat,USR_SOURCE_DIGEST_FORMAT);
assert.deepEqual(first.metrics,{ownershipRows:2,blockingOwnershipRows:1,governanceSpecBytes:16,coverageMatrixBytes:15,requiredReferenceCount:1});
await fs.writeFile(path.join(root,'governance.md'),'# Governance\né\n# Coverage\n');await fs.writeFile(path.join(root,'coverage.md'),'row\n');
const second=await createGovernanceDriftReport({configPath,inputRoot:root});
assert.notEqual(first.sourceDigest,second.sourceDigest);assert.equal(second.metrics.governanceSpecBytes,27);assert.equal(second.metrics.coverageMatrixBytes,4);
const reports=['item35-framework-canonicalization','item36-backcompat-matrix','item38-catalog-contract','item39-normalization-linking-identity','item40-pipeline-incremental-transforms'];
const metricKeys=[['frameworkProfiles','edgeCaseRows','fixtureRows','requiredFrameworks','frameworksWithTemplateAndStyleCoverage','frameworksWithCompleteFixtureEdgeCaseCoverage'],
  ['totalRows','strictRows','nonStrictRows','blockingRows','pairwiseExpandedRows','requiredScenarios','configuredStrictScenarios','configuredAdvisoryScenarios','requiredScenarioRows'],
  ['languageProfiles','frameworkProfiles','frameworkEdgeCases','capabilityRows','versionRows','embeddingRows'],
  ['nodeKindMappings','normalizedKinds','edgeKindConstraints','uniqueEdgeKinds'],
  ['languageProfiles','parserRuntimeLocks','uniqueParserSources','languageParserPreferences','requiredParserSources','generatedProvenanceRows',
    'approximateProvenanceRows','failureInjectionRows','blockingFailureRows','uniqueFailureLayers','requiredFailureLayers']];
for(const name of reports) {
  const target=path.join(root,name+'.json');const result=await spawnSubprocess(process.execPath,['tools/bench/usr/'+name+'.js','--json',target,'--quiet'],
    {timeoutMs:30000,captureStdout:true,captureStderr:true,maxOutputBytes:65536,rejectOnNonZeroExit:true});
  assert.equal(result.stderr,'');const report=JSON.parse(await fs.readFile(target,'utf8'));
  assert.equal(report.sourceDigestVersion,USR_SOURCE_DIGEST_VERSION);assert.equal(report.sourceDigestFormat,USR_SOURCE_DIGEST_FORMAT);
  assert.deepEqual(Object.keys(report.metrics),metricKeys[reports.indexOf(name)],'every original nonidentity metric remains');
  assert.ok(Object.values(report.metrics).every(value=>Number.isSafeInteger(value)&&value>=0));
  if(name.startsWith('item35'))assert.ok(report.fixtureCoverageByFramework&&typeof report.fixtureCoverageByFramework==='object');
  if(name.startsWith('item38'))assert.deepEqual(Object.keys(report.malformedRows),metricKeys[2]);
}
console.log('Named USR source frames distinguish file boundaries, roles and exact UTF8 bytes through all actual report consumers.');
