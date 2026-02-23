#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { replaceFile } from '../../src/shared/json-stream.js';
import { getDictConfig, resolveRepoConfig } from '../shared/dict-utils.js';
import { fetchDownloadUrl } from './shared-fetch.js';
import {
  parseHashOverrides,
  resolveDownloadPolicy,
  resolveExpectedHash,
  verifyDownloadHash
} from '../shared/download-utils.js';
import { parseNameUrlSources } from '../shared/input-parsers.js';
import { readJsonFileSafe, writeJsonFile } from '../shared/json-utils.js';

const DEFAULT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const argv = createCli({
  scriptName: 'download-dicts',
  options: {
    update: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    lang: { type: 'string' },
    dir: { type: 'string' },
    url: { type: 'string', array: true },
    sha256: { type: 'string', array: true },
    repo: { type: 'string' }
  }
}).parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const defaultDictConfig = getDictConfig(repoRoot, userConfig);

const dictDir = argv.dir ? path.resolve(argv.dir) : defaultDictConfig.dir;
await fs.mkdir(dictDir, { recursive: true });
await fs.mkdir(path.join(dictDir, 'slang'), { recursive: true });
await fs.mkdir(path.join(dictDir, 'repos'), { recursive: true });

const manifestPath = path.join(dictDir, 'dictionaries.json');
let manifest = (await readJsonFileSafe(manifestPath, {})) || {};

const hashOverrides = parseHashOverrides(argv.sha256);
const downloadPolicy = resolveDownloadPolicy(userConfig, { defaultMaxBytes: DEFAULT_MAX_DOWNLOAD_BYTES });

const SOURCES = {
  en: {
    name: 'en',
    url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
    file: 'en.txt'
  }
};

const streamToFile = (stream, outputPath, { maxBytes, expectedHash, policy }) => new Promise((resolve, reject) => {
  let total = 0;
  let lastByte = null;
  let failed = false;
  const hasher = expectedHash || policy?.requireHash ? crypto.createHash('sha256') : null;
  const tempPath = `${outputPath}.tmp`;
  const out = fsSync.createWriteStream(tempPath);
  const onError = async (err) => {
    if (failed) return;
    failed = true;
    try {
      out.destroy();
    } catch {}
    try {
      stream.destroy();
    } catch {}
    try {
      await fs.rm(tempPath, { force: true });
    } catch {}
    reject(err);
  };
  stream.on('data', (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (maxBytes && total > maxBytes) {
      void onError(new Error(`Download exceeds maximum size (${maxBytes} bytes).`));
      return;
    }
    if (hasher) hasher.update(buffer);
    lastByte = buffer.length ? buffer[buffer.length - 1] : lastByte;
    out.write(buffer);
  });
  stream.on('error', (err) => { void onError(err); });
  out.on('error', (err) => { void onError(err); });
  stream.on('end', () => {
    out.end(() => {
      const digest = hasher ? hasher.digest('hex') : null;
      resolve({ tempPath, bytes: total, lastByte, hashHex: digest });
    });
  });
});

/**
 * Download a dictionary source into the cache.
 * @param {{name:string,url:string,file:string}} source
 * @returns {Promise<{name:string,skipped:boolean}>}
 */
async function downloadSource(source) {
  const outputPath = path.join(dictDir, source.file);
  const entry = manifest[source.name] || {};

  if (!argv.force && !argv.update && fsSync.existsSync(outputPath)) {
    return { name: source.name, skipped: true };
  }

  const headers = {};
  if (argv.update) {
    if (entry.etag) headers['If-None-Match'] = entry.etag;
    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  }

  const response = await fetchDownloadUrl(source.url, {
    headers,
    responseType: 'stream',
    maxBytes: downloadPolicy.maxBytes,
    timeoutMs: downloadPolicy.timeoutMs,
    maxRedirects: downloadPolicy.maxRedirects
  });
  if (response.statusCode === 304) {
    response.stream?.resume?.();
    return { name: source.name, skipped: true };
  }
  if (response.statusCode !== 200) {
    response.stream?.resume?.();
    throw new Error(`Failed to download ${source.url}: ${response.statusCode}`);
  }

  const expectedHash = resolveExpectedHash(source, downloadPolicy, hashOverrides);
  const { tempPath, lastByte, hashHex } = await streamToFile(response.stream, outputPath, {
    maxBytes: downloadPolicy.maxBytes,
    expectedHash,
    policy: downloadPolicy
  });
  let actualHash = null;
  try {
    actualHash = verifyDownloadHash({
      source,
      expectedHash,
      actualHash: hashHex,
      policy: downloadPolicy,
      warn: (message) => console.warn(message)
    });
  } catch (err) {
    await fs.rm(tempPath, { force: true });
    throw err;
  }

  if (lastByte !== 10) {
    await fs.appendFile(tempPath, '\n');
  }
  await replaceFile(tempPath, outputPath);

  manifest[source.name] = {
    url: source.url,
    file: source.file,
    sha256: actualHash || expectedHash || null,
    verified: Boolean(expectedHash),
    etag: response.headers.etag || null,
    lastModified: response.headers['last-modified'] || null,
    downloadedAt: new Date().toISOString()
  };

  return { name: source.name, skipped: false };
}

const langs = argv.lang
  ? argv.lang.split(',').map((l) => l.trim()).filter(Boolean)
  : defaultDictConfig.languages;

const sources = [];
for (const lang of langs) {
  const src = SOURCES[lang];
  if (src) sources.push(src);
}

const urlSources = parseNameUrlSources(argv.url, {
  hashes: hashOverrides,
  fileNameFromName: (name) => `${name}.txt`
});
sources.push(...urlSources);

if (!sources.length) {
  console.error('No dictionary sources configured. Use --lang or --url name=url.');
  process.exit(1);
}

const results = [];
const failures = [];
for (const source of sources) {
  try {
    const result = await downloadSource(source);
    results.push(result);
  } catch (err) {
    const message = err?.message || String(err);
    failures.push({ name: source?.name || '(unknown)', message });
    console.error(`[download-dicts] ${source?.name || '(unknown)'}: ${message}`);
  }
}

await writeJsonFile(manifestPath, manifest, { trailingNewline: true });

const downloaded = results.filter((r) => !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
console.error(`Done. downloaded=${downloaded} skipped=${skipped} failed=${failures.length}`);
if (failures.length > 0) {
  process.exit(1);
}
