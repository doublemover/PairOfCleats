#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveDictionarySetupReadiness } from '../../../tools/setup/dictionary-readiness.js';
import { buildSetupReadiness } from '../../../tools/setup/readiness.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-dictionary-readiness-'));
const base = { dir: root, languages: [], files: [], includeSlang: false };
const resolve = (config, paths = []) => resolveDictionarySetupReadiness({ dictConfig: { ...base, ...config }, dictionaryPaths: paths });
try {
  const french = path.join(root, 'fr.txt');
  const custom = path.join(root, 'custom.txt');
  await fs.writeFile(french, 'bonjour\nmonde\n');
  await fs.writeFile(custom, 'custom\nwords\n');
  for (const [config, paths] of [[{ languages: ['fr'] }, [french]], [{ files: [custom] }, [custom]]]) {
    const result = resolve(config, paths);
    assert.equal(result.present, true, 'valid declared non-English/custom files remain usable');
    assert.deepEqual(result.downloadableLanguages, [], 'an unrelated English download is not requested');
    assert.equal(result.englishRequested, false);
  }
  const english = resolve({ languages: ['en'] }, [custom]);
  assert.equal(english.present, false, 'the documented English default still requires its configured wordlist');
  assert.deepEqual(english.downloadableLanguages, ['en']);
  await fs.writeFile(path.join(root, 'en.txt'), '');
  assert.equal(resolve({ languages: ['en'] }, [path.join(root, 'en.txt')]).replaceEmptyEnglish, true,
    'the existing downloader must not skip an empty default wordlist as already installed');
  await fs.rm(path.join(root, 'en.txt'));
  await fs.mkdir(path.join(root, 'en.txt'));
  assert.equal(resolve({ languages: ['en'] }).replaceEmptyEnglish, false, 'directory contents are never force-replaced');
  await fs.rm(path.join(root, 'en.txt'), { recursive: true });
  const unsupported = resolve({ languages: ['fr'] });
  assert.equal(unsupported.present, false);
  assert.deepEqual(unsupported.downloadableLanguages, [], 'missing unsupported resources are reported without inventing a source');
  assert.match(unsupported.reason, /No usable configured/);
  const empty = path.join(root, 'empty.txt');
  await fs.writeFile(empty, '');
  assert.equal(resolve({ files: [empty] }, [empty]).present, false);
  assert.equal(resolve({ files: [root] }, [root]).present, false, 'directories are not readable wordlist artifacts');
  const none = resolve({});
  assert.equal(none.applicable, false);
  assert.equal(buildSetupReadiness({ steps: { dictionaries: { skipped: false, ...none } } }).items[0].state, 'not-applicable');
  await fs.writeFile(path.join(root, 'en.txt'), 'hello\nworld\n');
  const installed = resolve({ languages: ['en'] }, [path.join(root, 'en.txt')]);
  assert.equal(installed.present, true);
  assert.equal(installed.verificationLevel, 'nonempty-readable-effective-files');
  console.log('Dictionary readiness preserves configured English, non-English/custom files and explicit no-source state without unrelated downloads.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
