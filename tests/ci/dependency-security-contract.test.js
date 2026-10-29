#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import semver from 'semver';
import { ensureTestingEnv } from '../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const manifest = readJson('package.json');
const lock = readJson('package-lock.json');
const baseline = readJson('tests/fixtures/security/dependency-advisories-2026-10-02.json');
const additions = readJson('tests/fixtures/security/dependency-advisories-2026-10-06.json');
const current = readJson('tests/fixtures/security/dependency-advisories-2026-10-24.json');
const october28 = readJson('tests/fixtures/security/dependency-advisories-2026-10-28.json');

assert.equal(lock.lockfileVersion, 3, 'dependency security checks require the complete npm lock graph');
for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'engines']) {
  assert.deepEqual(lock.packages[''][field], manifest[field], `lockfile root must match package.json ${field}`);
}
assert.ok(manifest.dependencies['@huggingface/transformers'], 'use the maintained Transformers.js package');
assert.equal(manifest.dependencies['@xenova/transformers'], undefined, 'do not restore the vulnerable v2 runtime');
assert.equal(manifest.dependencies.mammoth, '1.13.0', 'the reviewed Mammoth CLI patch requires an exact package version');
assert.equal(manifest.overrides?.mammoth?.argparse, '3.0.4', 'remove the unpatched sprintf chain through the reviewed argparse migration');

const minimumNode = semver.minVersion(manifest.engines.node);
assert.ok(minimumNode && semver.gte(minimumNode, '24.15.0'), 'patched native dependencies require Node 24.15+');
const supportsTarget = (constraints, target) => !Array.isArray(constraints)
  || (!constraints.includes(`!${target}`)
    && (constraints.every((value) => value.startsWith('!')) || constraints.includes(target)));
const failures = [];
for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (!packagePath || !entry.version) continue;
  const packageName = entry.name || packagePath.split('node_modules/').at(-1);
  // GHSA-vfj7-8cjw-p6xm has no patched braces release as of 2026-10-05.
  // Keep this later advisory explicit without rewriting the historical baseline.
  if (packageName === 'braces' && semver.satisfies(entry.version, '<=3.0.3')) {
    failures.push(`${packagePath}@${entry.version}: vulnerable recursive brace expansion`);
  }
  for (const advisories of [baseline, additions, current, october28]) {
    const advisory = advisories.packages[packageName];
    if (advisory && semver.satisfies(entry.version, advisory.range, { includePrerelease: true })) {
      failures.push(`${packagePath}@${entry.version}: known vulnerable range ${advisory.range}`);
    }
  }
  // npm skips optional binaries for other platforms (e.g. Windows ia32 Sharp
  // supports only Node 20). Security ranges above still cover every platform.
  const installedOnTarget = !entry.optional
    || (supportsTarget(entry.os, process.platform) && supportsTarget(entry.cpu, process.arch));
  if (installedOnTarget && entry.engines?.node && !semver.satisfies(minimumNode, entry.engines.node)) {
    failures.push(`${packagePath}@${entry.version}: engine ${entry.engines.node} excludes the declared minimum Node`);
  }
}
assert.deepEqual(failures, [], 'the lock graph must stay fixed and target-compatible with the minimum Node version');

// Identity currently selects MSAL 6; the scoped security override selects 7.
// Exercise that real adapter through discovery, acquisition and cached reuse.
// This transport owns every request: no live authentication or network fallback.
let discoveryRequests = 0, tokenRequests = 0;
const transportFailures = [];
const vsceRequire = createRequire(import.meta.resolve('@vscode/vsce'));
const identityEntry = vsceRequire.resolve('@azure/identity');
const identityRequire = createRequire(identityEntry);
const { ClientSecretCredential } = await import(pathToFileURL(identityEntry).href);
const { createHttpHeaders } = await import(pathToFileURL(identityRequire.resolve('@azure/core-rest-pipeline')).href);
const authority = 'https://identity.fixture.invalid';
const tenant = '11111111-1111-1111-1111-111111111111';
const endpoint = `${authority}/${tenant}/oauth2/v2.0/token`;
const credential = new ClientSecretCredential(tenant, '22222222-2222-2222-2222-222222222222', 'fixture-secret', {
  authorityHost: authority, disableInstanceDiscovery: true,
  httpClient: { async sendRequest(request) {
    try {
      let body;
      if (request.method === 'GET' && request.url === `${authority}/${tenant}/v2.0/.well-known/openid-configuration`) {
        discoveryRequests++;
        body = { issuer: `${authority}/${tenant}/v2.0`, token_endpoint: endpoint,
          authorization_endpoint: `${authority}/${tenant}/oauth2/v2.0/authorize`,
          jwks_uri: `${authority}/${tenant}/discovery/v2.0/keys` };
      } else {
        const tokenUrl = new URL(request.url);
        assert.match(tokenUrl.searchParams.get('client-request-id'), /^[a-f0-9-]{36}$/u);
        tokenUrl.searchParams.delete('client-request-id');
        assert.equal(tokenUrl.href, endpoint, 'only the exact fixture token endpoint is admitted');
        assert.equal(request.method, 'POST');
        const form = new URLSearchParams(request.body);
        assert.equal(form.get('grant_type'), 'client_credentials');
        assert.equal(form.get('client_secret'), 'fixture-secret');
        assert.equal(form.get('scope'), 'https://resource.fixture.invalid/.default');
        tokenRequests++;
        body = { access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600 };
      }
      return { request, status: 200, headers: createHttpHeaders({ 'content-type': 'application/json' }), bodyAsText: JSON.stringify(body) };
    } catch (error) { transportFailures.push(error); throw error; }
  } }
});
for (let attempt = 0; attempt < 2; attempt++) {
  const token = await credential.getToken('https://resource.fixture.invalid/.default').catch(error => {
    throw new AggregateError([error, ...transportFailures], 'Identity/MSAL offline token flow failed.');
  });
  assert.equal(token.token, 'fixture-token');
  assert.ok(token.expiresOnTimestamp > Date.now());
}
assert.equal(discoveryRequests, 1);
assert.equal(tokenRequests, 1, 'the real Identity/MSAL cache reuses the acquired token');

const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
assert.match(workflow, /run:\s*npm audit --audit-level=low\s*\n/, 'CI must also check current advisories, including dev/optional packages');
assert.match(workflow, /shell: pwsh[\s\S]*npm run bootstrap:ci\s*\r?\n\s*if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/,
  'Windows bootstrap failures must stop before version-report commands can mask them');
console.log('dependency security and engine contract passed');
