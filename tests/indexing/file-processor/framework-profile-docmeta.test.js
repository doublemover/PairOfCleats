#!/usr/bin/env node

import {
  createFileProcessorFixture,
  createFileProcessorForTest,
  createScannedFileEntry,
  writeFixtureFile
} from './file-processor-fixture.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { repoRoot } = await createFileProcessorFixture('framework-profile-docmeta');

const source = [
  "'use client';",
  'export default function Page({ params }) {',
  '  return <div>{params.slug}</div>;',
  '}'
].join('\n');
const target = await writeFixtureFile({
  root: repoRoot,
  rel: ['app', 'blog', '[slug]', 'page.tsx'],
  contents: source
});

const { processFile } = createFileProcessorForTest({
  root: repoRoot,
  languageOptions: {
    skipUnknownLanguages: true,
    treeSitter: { enabled: false }
  }
});

const fileEntry = createScannedFileEntry({
  abs: target.targetPath,
  rel: target.rel,
  stat: target.stat,
  lines: source.split('\n').length
});

const result = await processFile(fileEntry, 0);
if (!result?.chunks?.length) {
  fail('Expected Next page file to produce chunks.');
}

const frameworkProfile = result.chunks[0]?.docmeta?.frameworkProfile;
if (!frameworkProfile || frameworkProfile.id !== 'next') {
  fail('Expected framework profile id=next in chunk docmeta.');
}
if (frameworkProfile.signals?.nextAppRouterDynamicSegment !== true) {
  fail('Expected nextAppRouterDynamicSegment signal for dynamic app route.');
}

console.log('framework profile docmeta test passed');
