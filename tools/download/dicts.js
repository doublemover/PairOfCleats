#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { replaceFile } from '../../src/shared/json-stream/atomic.js';
import { getDictConfig, resolveRepoConfig } from '../shared/dict-utils.js';
import { fetchDownloadUrl } from './shared-fetch.js';
import {
  parseHashOverrides,
  resolveDownloadPolicy,
  resolveExpectedHash,
  verifyDownloadHash
} from '../shared/download-utils.js';
import { assertDownloadFileName, parseNameUrlSources } from '../shared/input-parsers.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { closeDictionaryResources, runDictionaryWriteSession, streamDictionaryToFile } from './dictionary-write-session.js';

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
const controller = new AbortController();
const onInterrupt = () => { process.exitCode = 130; controller.abort(new Error('Dictionary download interrupted.')); };
const onTerminate = () => { process.exitCode = 143; controller.abort(new Error('Dictionary download terminated.')); };
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);
try {
await runDictionaryWriteSession({ dictDir, signal: controller.signal }, async ({ signal, trackResource }) => {
await fs.mkdir(dictDir, { recursive: true });
await fs.mkdir(path.join(dictDir, 'slang'), { recursive: true });
await fs.mkdir(path.join(dictDir, 'repos'), { recursive: true });

const manifestPath = path.join(dictDir, 'dictionaries.json');
const manifestStat = await fs.lstat(manifestPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (manifestStat && (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 8 * 1024 * 1024)) throw new Error('Dictionary manifest must be a bounded regular file; existing evidence was preserved.');
let manifest = manifestStat ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : {};
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Dictionary manifest must be an object; existing evidence was preserved.');

const hashOverrides = parseHashOverrides(argv.sha256);
const downloadPolicy = resolveDownloadPolicy(userConfig, { defaultMaxBytes: DEFAULT_MAX_DOWNLOAD_BYTES });

const SOURCES = {
  en: {
    name: 'en',
    url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
    file: 'en.txt'
  }
};

const hasUsableLocalBytes = async (file) => {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > downloadPolicy.maxBytes) return false;
    await fs.access(file, fsSync.constants.R_OK);
    return true;
  } catch { return false; }
};

/**
 * Download a dictionary source into the cache.
 * @param {{name:string,url:string,file:string}} source
 * @returns {Promise<{name:string,skipped:boolean}>}
 */
async function downloadSource(source) {
  const sourceResources = [];
  const trackSourceResource = resource => { sourceResources.push(resource); return trackResource(resource); };
  let primaryError = null;
  try {
  const outputPath = path.join(dictDir, assertDownloadFileName(source.file));
  const entry = manifest[source.name] || {};

  if (!argv.force && !argv.update && fsSync.existsSync(outputPath)) {
    return { name: source.name, skipped: true };
  }

  const headers = {};
  const expectedHash = resolveExpectedHash(source, downloadPolicy, hashOverrides);
  const canReuse = argv.update && !argv.force && entry.url === source.url && entry.file === source.file
    && (!expectedHash || (entry.verified === true && entry.sha256 === expectedHash))
    && await hasUsableLocalBytes(outputPath);
  if (canReuse) {
    if (entry.etag) headers['If-None-Match'] = entry.etag;
    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  }

  const response = await fetchDownloadUrl(source.url, {
    headers,
    responseType: 'stream',
    maxBytes: downloadPolicy.maxBytes,
    timeoutMs: downloadPolicy.timeoutMs,
    maxRedirects: downloadPolicy.maxRedirects,
    signal, onResource: trackSourceResource
  });
  if (response.statusCode === 304) {
    response.stream?.resume?.();
    if (!canReuse || !await hasUsableLocalBytes(outputPath)) {
      throw new Error(`Unexpected 304 for ${source.url}: usable local dictionary bytes are unavailable.`);
    }
    return { name: source.name, skipped: true };
  }
  if (response.statusCode !== 200) {
    response.stream?.resume?.();
    throw new Error(`Failed to download ${source.url}: ${response.statusCode}`);
  }

  const { tempPath, bytes, lastByte, hashHex } = await streamDictionaryToFile(response.stream, outputPath, {
    maxBytes: downloadPolicy.maxBytes,
    expectedHash,
    policy: downloadPolicy, signal, trackResource: trackSourceResource
  });
  if (!bytes) throw new Error(`Downloaded empty dictionary payload for ${source.name}.`);
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
  } catch (error) { primaryError = error; throw error; }
  finally { await closeDictionaryResources(sourceResources, { primaryError }); }
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
  throw new Error('No selected dictionary sources; no network request ran.');
}

const results = [];
const failures = [];
for (const source of sources) {
  signal.throwIfAborted();
  try {
    const result = await downloadSource(source);
    results.push(result);
  } catch (err) {
    if (signal.aborted || err.cacheOwnershipPending) throw err;
    const message = err?.message || String(err);
    failures.push({ name: source?.name || '(unknown)', message });
    console.error(`[download-dicts] ${source?.name || '(unknown)'}: ${message}`);
  }
}

await atomicWriteJson(manifestPath, manifest, { mkdir: false });

const downloaded = results.filter((r) => !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
console.error(`Done. downloaded=${downloaded} skipped=${skipped} failed=${failures.length}`);
if (failures.length > 0) {
  process.exitCode = 1;
}
});
} catch (error) {
  console.error(`[download-dicts] ${error.message}`);
  if (error.cacheOwnershipPending) console.error('[download-dicts] Actual request/output closure remains unconfirmed; dictionary storage lease and publication lock are retained.');
  if (!process.exitCode) process.exitCode = 1;
} finally {
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
}
