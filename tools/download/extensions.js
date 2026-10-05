#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';
import {
  parseHashOverrides,
  resolveExpectedHash,
  verifyDownloadHash
} from '../shared/download-utils.js';
import { assertDownloadFileName, parseNameUrlSources } from '../shared/input-parsers.js';
import { extensionDownloadPolicy } from '../sqlite/extension-trust.js';
import { readJsonFileSafe } from '../../src/shared/file-read.js';
import { writeJsonFile } from '../../src/shared/json-file.js';
import { getBinarySuffix, getPlatformKey, getVectorExtensionConfig, resolveVectorExtensionPath } from '../sqlite/vector-extension.js';
import { fetchDownloadUrl } from './shared-fetch.js';
import { extractArchive } from '../shared/archive-extraction.js';

let logger = console;

const argv = createCli({
  scriptName: 'download-extensions',
  options: {
    update: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    provider: { type: 'string' },
    dir: { type: 'string' },
    url: { type: 'string' },
    sha256: { type: 'string', array: true },
    out: { type: 'string' },
    platform: { type: 'string' },
    arch: { type: 'string' },
    repo: { type: 'string' },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();

const display = createToolDisplay({ argv, stream: process.stderr });
logger = {
  log: (message) => display.log(message),
  warn: (message) => display.warn(message),
  error: (message) => display.error(message)
};
const fail = (message, code = 1) => {
  logger.error(message);
  display.close();
  process.exit(code);
};

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const overrides = {
  provider: argv.provider,
  dir: argv.dir,
  platform: argv.platform,
  arch: argv.arch,
  path: argv.out || undefined
};
const config = getVectorExtensionConfig(repoRoot, userConfig, overrides);

const extensionDir = config.dir;
await fs.mkdir(extensionDir, { recursive: true });

const manifestPath = path.join(extensionDir, 'extensions.json');
let manifest = (await readJsonFileSafe(manifestPath, {})) || {};

const FILE_MODE = 0o644;
const OUTPUT_MODE = process.platform === 'win32' ? FILE_MODE : 0o755;
const DEFAULT_ARCHIVE_LIMITS = {
  maxBytes: 200 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  maxEntries: 2048
};

const normalizeLimit = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(fallback, Math.floor(parsed));
  return fallback;
};

const resolveArchiveLimits = (cfg) => {
  const archives = cfg?.security?.archives || {};
  return {
    maxBytes: normalizeLimit(archives.maxBytes, DEFAULT_ARCHIVE_LIMITS.maxBytes),
    maxEntryBytes: normalizeLimit(archives.maxEntryBytes, DEFAULT_ARCHIVE_LIMITS.maxEntryBytes),
    maxEntries: normalizeLimit(archives.maxEntries, DEFAULT_ARCHIVE_LIMITS.maxEntries)
  };
};

const hashOverrides = parseHashOverrides(argv.sha256);
const downloadPolicy = extensionDownloadPolicy(userConfig);
const archiveLimits = resolveArchiveLimits(userConfig);

/**
 * Identify the archive type from a filename or URL.
 * @param {string|undefined|null} value
 * @returns {string|null}
 */
function getArchiveType(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

/**
 * Resolve archive type for a source configuration.
 * @param {{url?:string,file?:string}} source
 * @returns {string|null}
 */
function getArchiveTypeForSource(source) {
  return getArchiveType(source.file) || getArchiveType(source.url);
}

/**
 * Find a file inside a directory tree matching a name or suffix.
 * @param {string} rootDir
 * @param {string|null} targetName
 * @param {string|null} suffix
 * @returns {Promise<string|null>}
 */
async function findFile(rootDir, targetName, suffix) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const dirs = [];
  const matches = [];
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      dirs.push(full);
      continue;
    }
    if (targetName && entry.name === targetName) {
      return full;
    }
    if (suffix && entry.name.toLowerCase().endsWith(suffix)) {
      matches.push(full);
    }
  }
  for (const dir of dirs) {
    const found = await findFile(dir, targetName, suffix);
    if (found) return found;
  }
  return matches.length ? matches[0] : null;
}

/**
 * Resolve a download source from configuration overrides.
 * @param {object} cfg
 * @returns {{name:string,url:string,file:string}|null}
 */
function resolveSourceFromConfig(cfg) {
  const downloads = cfg.downloads || {};
  const byPlatform = downloads[cfg.platformKey]
    || downloads[getPlatformKey(cfg.platform, cfg.arch)]
    || downloads[`${cfg.platform}/${cfg.arch}`];
  if (byPlatform && typeof byPlatform === 'object') {
    return {
      name: cfg.provider,
      url: byPlatform.url,
      file: byPlatform.file || cfg.filename,
      sha256: byPlatform.sha256 || byPlatform.hash || null
    };
  }
  if (typeof byPlatform === 'string') {
    return { name: cfg.provider, url: byPlatform, file: cfg.filename };
  }
  if (cfg.url) {
    return { name: cfg.provider, url: cfg.url, file: cfg.filename };
  }
  return null;
}

const suffix = getBinarySuffix(config.platform);
const sources = parseNameUrlSources(argv.url, {
  hashes: hashOverrides,
  fileNameFromName: (name) => (name.includes('.') ? name : `${name}${suffix}`)
});
if (!sources.length) {
  const fallback = resolveSourceFromConfig(config);
  if (fallback?.url) sources.push(fallback);
}

if (!sources.length) {
  fail('No extension sources configured. Use --url name=url or set sqlite.vectorExtension.url/downloads.');
}

if (argv.out && sources.length > 1) {
  fail('When using --out, provide exactly one source.');
}

/**
 * Resolve the output path for a download target.
 * @param {{file?:string}} source
 * @param {number} index
 * @returns {Promise<string>}
 */
async function resolveOutputPath(source, index) {
  if (argv.out) return path.resolve(argv.out);
  if (config.path && index === 0) return config.path;
  const targetDir = path.join(extensionDir,
    assertDownloadFileName(config.provider), assertDownloadFileName(config.platformKey));
  await fs.mkdir(targetDir, { recursive: true });
  const archiveType = getArchiveTypeForSource(source);
  const fileName = archiveType ? config.filename : (source.file || config.filename);
  return path.join(targetDir, assertDownloadFileName(fileName));
}

/**
 * Download and extract a vector extension source.
 * @param {{name:string,url:string,file?:string}} source
 * @param {number} index
 * @returns {Promise<{name:string,skipped:boolean,outputPath:string}>}
 */
async function downloadSource(source, index) {
  assertDownloadFileName(source.name);
  const expectedHash = resolveExpectedHash(source, downloadPolicy, hashOverrides);
  if (!expectedHash) throw new Error('Native extension downloads require an approved SHA256 digest.');
  const outputPath = await resolveOutputPath(source, index);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const key = `${config.provider}:${config.platformKey}`;
  const entry = manifest[key] || {};
  const archiveType = getArchiveTypeForSource(source);
  const archiveSuffix = archiveType === 'tar.gz'
    ? '.tar.gz'
    : archiveType
      ? `.${archiveType}`
      : '';
  const tempRoot = path.join(extensionDir, '.tmp');
  await fs.mkdir(tempRoot, { recursive: true });
  const transactionRoot = await fs.mkdtemp(path.join(tempRoot, 'download-'));
  const downloadPath = path.join(transactionRoot, `source${archiveSuffix}`);
  const stagedOutput = path.join(transactionRoot, 'extension');
  try {
    const existingHash = fsSync.existsSync(outputPath)
      ? crypto.createHash('sha256').update(await fs.readFile(outputPath)).digest('hex') : null;
    const existingVerified = entry.verified && entry.url === source.url
    && entry.sha256 === expectedHash && entry.outputSha256 === existingHash;

    if (!argv.force && !argv.update && fsSync.existsSync(outputPath)) {
      if (existingVerified) return { name: source.name, skipped: true, outputPath };
    }

    const headers = {};
    if (argv.update && existingVerified) {
      if (entry.etag) headers['If-None-Match'] = entry.etag;
      if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
    }

    const response = await fetchDownloadUrl(source.url, {
      headers,
      maxBytes: archiveLimits.maxBytes,
      timeoutMs: downloadPolicy.timeoutMs,
      maxRedirects: downloadPolicy.maxRedirects
    });
    if (response.statusCode === 304) {
      if (!existingVerified) throw new Error('Unverified native bytes cannot be accepted from a304 response.');
      return { name: source.name, skipped: true, outputPath };
    }
    if (response.statusCode !== 200) {
      throw new Error(`Failed to download ${source.url}: ${response.statusCode}`);
    }
    const actualHash = verifyDownloadHash({
      source,
      expectedHash,
      actualHash: crypto.createHash('sha256').update(response.body).digest('hex'),
      policy: downloadPolicy,
      warn: (message) => logger.warn(message)
    });

    if (archiveType) {
      await fs.mkdir(tempRoot, { recursive: true });
    }
    const writeMode = archiveType ? FILE_MODE : OUTPUT_MODE;
    await fs.writeFile(downloadPath, response.body, { mode: writeMode });

    let extractedFrom = null;
    if (archiveType) {
      const extractDir = path.join(transactionRoot, 'extracted');
      await fs.mkdir(extractDir, { recursive: true });
      const ok = await extractArchive(downloadPath, extractDir, archiveType, archiveLimits);
      if (!ok) {
        throw new Error(`Failed to extract ${downloadPath} (${archiveType})`);
      }
      const extractedPath = await findFile(extractDir, config.filename, suffix);
      if (!extractedPath) {
        throw new Error(`No extension binary found in ${downloadPath}`);
      }
      await fs.copyFile(extractedPath, stagedOutput);
      if (process.platform !== 'win32') {
        try {
          await fs.chmod(stagedOutput, OUTPUT_MODE);
        } catch {}
      }
      extractedFrom = path.relative(extensionDir, extractedPath);
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.rm(downloadPath, { force: true });
    }
    if (!archiveType) await fs.copyFile(downloadPath, stagedOutput);

    if (!archiveType && process.platform !== 'win32') {
      try {
        await fs.chmod(stagedOutput, OUTPUT_MODE);
      } catch {}
    }
    const outputSha256 = crypto.createHash('sha256').update(await fs.readFile(stagedOutput)).digest('hex');
    await fs.rename(stagedOutput, outputPath);

    manifest[key] = {
      name: source.name,
      url: source.url,
      file: path.basename(outputPath),
      outputPath: path.relative(extensionDir, outputPath),
      archive: archiveType,
      extractedFrom,
      provider: config.provider,
      platform: config.platform,
      arch: config.arch,
      sha256: actualHash || expectedHash || null,
      outputSha256,
      verified: Boolean(expectedHash),
      etag: response.headers.etag || null,
      lastModified: response.headers['last-modified'] || null,
      downloadedAt: new Date().toISOString()
    };

    return { name: source.name, skipped: false, outputPath };
  } finally {
    await fs.rm(transactionRoot, { recursive: true, force: true });
  }
}

const results = [];
let failedDownloads = 0;
for (let i = 0; i < sources.length; i++) {
  const source = sources[i];
  display.showProgress('Downloads', i, sources.length, { stage: 'extensions' });
  try {
    results.push(await downloadSource(source, i));
  } catch (err) {
    failedDownloads += 1;
    logger.error(String(err));
  }
}
display.showProgress('Downloads', sources.length, sources.length, { stage: 'extensions' });

await writeJsonFile(manifestPath, manifest, { trailingNewline: true });

const downloaded = results.filter((r) => !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
const resolvedPath = resolveVectorExtensionPath(config);
if (resolvedPath && fsSync.existsSync(resolvedPath)) {
  logger.log(`Extension present at ${resolvedPath}`);
}
logger.log(`Done. downloaded=${downloaded} skipped=${skipped}`);
display.close();
if (failedDownloads) process.exitCode = 1;
