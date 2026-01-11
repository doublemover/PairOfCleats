#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { createCli } from '../src/shared/cli.js';
import { createError, ERROR_CODES } from '../src/shared/error-codes.js';
import { loadUserConfig, resolveRepoRoot } from './dict-utils.js';
import { getBinarySuffix, getPlatformKey, getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

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
    repo: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const repoRoot = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
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
let manifest = {};
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) || {};
} catch {
  manifest = {};
}

const FILE_MODE = 0o644;
const DIR_MODE = 0o755;
const DEFAULT_ARCHIVE_LIMITS = {
  maxBytes: 200 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  maxEntries: 2048
};

const normalizeLimit = (value, fallback) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

const normalizeHash = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('sha256:') ? trimmed.slice(7) : trimmed;
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return normalized;
};

const parseHashes = (input) => {
  if (!input) return {};
  const items = Array.isArray(input) ? input : [input];
  const out = {};
  for (const item of items) {
    const eq = String(item || '').indexOf('=');
    if (eq <= 0 || eq >= item.length - 1) continue;
    const name = item.slice(0, eq);
    const hash = normalizeHash(item.slice(eq + 1));
    if (name && hash) out[name] = hash;
  }
  return out;
};

const resolveDownloadPolicy = (cfg) => {
  const policy = cfg?.security?.downloads || {};
  const allowlist = policy.allowlist && typeof policy.allowlist === 'object'
    ? policy.allowlist
    : {};
  return {
    requireHash: policy.requireHash === true,
    warnUnsigned: policy.warnUnsigned !== false,
    allowlist
  };
};

const resolveArchiveLimits = (cfg) => {
  const archives = cfg?.security?.archives || {};
  return {
    maxBytes: normalizeLimit(archives.maxBytes, DEFAULT_ARCHIVE_LIMITS.maxBytes),
    maxEntryBytes: normalizeLimit(archives.maxEntryBytes, DEFAULT_ARCHIVE_LIMITS.maxEntryBytes),
    maxEntries: normalizeLimit(archives.maxEntries, DEFAULT_ARCHIVE_LIMITS.maxEntries)
  };
};

const resolveExpectedHash = (source, policy, overrides) => {
  const explicit = normalizeHash(source?.sha256 || source?.hash);
  if (explicit) return explicit;
  const allowlist = policy?.allowlist || {};
  const fallback = overrides?.[source?.name]
    || overrides?.[source?.url]
    || overrides?.[source?.file]
    || allowlist[source?.name]
    || allowlist[source?.url]
    || allowlist[source?.file];
  return normalizeHash(fallback);
};

const verifyDownloadHash = (source, buffer, expectedHash, policy) => {
  if (!expectedHash) {
    if (policy?.requireHash) {
      throw createError(
        ERROR_CODES.DOWNLOAD_VERIFY_FAILED,
        `Download verification requires a sha256 hash (${source?.name || source?.url || 'unknown source'}).`
      );
    }
    if (policy?.warnUnsigned) {
      console.warn(`[download] Skipping hash verification for ${source?.name || source?.url || 'unknown source'}.`);
    }
    return null;
  }
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actual !== expectedHash) {
    throw createError(
      ERROR_CODES.DOWNLOAD_VERIFY_FAILED,
      `Download verification failed for ${source?.name || source?.url || 'unknown source'}.`
    );
  }
  return actual;
};

const hashOverrides = parseHashes(argv.sha256);
const downloadPolicy = resolveDownloadPolicy(userConfig);
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

function normalizeArchiveEntry(entryName) {
  const name = String(entryName || '').replace(/\\/g, '/').trim();
  let cleaned = name.replace(/^(\.\/)+/, '');
  cleaned = cleaned.replace(/^\/+/, '');
  // Handle Windows extended-length paths that can appear as //?/C:/...
  cleaned = cleaned.replace(/^\?\//, '');
  // Strip Windows drive-letter prefixes (e.g., C:, C:/, C:\)
  cleaned = cleaned.replace(/^[A-Za-z]:/, '');
  cleaned = cleaned.replace(/^\/+/, '');
  return path.posix.normalize(cleaned);
}

function isArchivePathSafe(rootDir, entryName) {
  const normalized = normalizeArchiveEntry(entryName);
  if (!normalized) return false;
  if (normalized === '.' || normalized === '..') return false;
  if (normalized.startsWith('../') || normalized.includes('/../')) return false;
  if (/^[A-Za-z]:/.test(normalized)) return false;
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return false;
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, normalized);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (process.platform === 'win32') {
    return resolved.toLowerCase().startsWith(rootPrefix.toLowerCase());
  }
  return resolved.startsWith(rootPrefix);
}

function resolveArchivePath(rootDir, entryName) {
  if (!isArchivePathSafe(rootDir, entryName)) return null;
  const normalized = normalizeArchiveEntry(entryName);
  return path.resolve(rootDir, normalized);
}

function isZipSymlink(entry) {
  const attr = entry?.header?.attr;
  if (typeof attr !== 'number') return false;
  const mode = attr >>> 16;
  return (mode & 0o170000) === 0o120000;
}

function createArchiveLimiter(limits) {
  const maxEntries = Number.isFinite(limits?.maxEntries) ? limits.maxEntries : null;
  const maxEntryBytes = Number.isFinite(limits?.maxEntryBytes) ? limits.maxEntryBytes : null;
  const maxBytes = Number.isFinite(limits?.maxBytes) ? limits.maxBytes : null;
  let entries = 0;
  let totalBytes = 0;
  const checkTotals = () => {
    if (maxBytes && totalBytes > maxBytes) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `Archive exceeds max size (${totalBytes} > ${maxBytes}).`);
    }
  };
  const checkEntry = (name, size) => {
    entries += 1;
    if (maxEntries && entries > maxEntries) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `Archive exceeds entry limit (${entries} > ${maxEntries}).`);
    }
    const entryBytes = Number.isFinite(size) && size > 0 ? size : 0;
    if (maxEntryBytes && entryBytes > maxEntryBytes) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `Archive entry too large (${name}).`);
    }
    totalBytes += entryBytes;
    checkTotals();
    return entryBytes;
  };
  const addBytes = (delta) => {
    if (!Number.isFinite(delta) || delta <= 0) return;
    totalBytes += delta;
    checkTotals();
  };
  return { checkEntry, addBytes };
}


async function extractZipNode(archivePath, destDir, limits) {
  const mod = await import('adm-zip');
  const AdmZip = mod.default || mod;
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const limiter = createArchiveLimiter(limits);
  await fs.mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    if (isZipSymlink(entry)) {
      throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe zip entry (symlink): ${entry.entryName}`);
    }
    const targetPath = resolveArchivePath(destDir, entry.entryName);
    if (!targetPath) {
      throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe zip entry: ${entry.entryName}`);
    }
    const declaredSize = Number(entry?.header?.size);
    const counted = limiter.checkEntry(entry.entryName, Number.isFinite(declaredSize) ? declaredSize : 0);
    if (entry.isDirectory) {
      await fs.mkdir(targetPath, { recursive: true });
      try { await fs.chmod(targetPath, DIR_MODE); } catch {}
      continue;
    }
    const data = entry.getData();
    if (limits?.maxEntryBytes && data.length > limits.maxEntryBytes) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `archive entry too large (${entry.entryName}).`);
    }
    if (data.length > counted) {
      limiter.addBytes(data.length - counted);
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, data, { mode: FILE_MODE });
    try { await fs.chmod(targetPath, FILE_MODE); } catch {}
  }
  return true;
}

async function extractTarNode(archivePath, destDir, gzip, limits) {
  const mod = await import('tar-stream');
  const tarStream = mod.default || mod;
  const extract = tarStream.extract();
  const limiter = createArchiveLimiter(limits);
  await fs.mkdir(destDir, { recursive: true });
  extract.on('entry', (header, stream, next) => {
    const rawName = header?.name || '';
    const normalized = normalizeArchiveEntry(rawName);
    const type = header?.type || 'file';

    (async () => {
      // Reject symlinks/hardlinks to avoid writing outside the destination or
      // creating unexpected filesystem references.
      if (type === 'symlink' || type === 'link') {
        throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe tar entry (symlink): ${rawName}`);
      }

      // Skip empty / root-ish entries.
      if (!normalized || normalized === '.' || normalized === '..') {
        stream.resume();
        return;
      }

      const targetPath = resolveArchivePath(destDir, normalized);
      if (!targetPath) {
        throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe tar entry: ${rawName}`);
      }

      if (type === 'directory') {
        await fs.mkdir(targetPath, { recursive: true });
        try { await fs.chmod(targetPath, DIR_MODE); } catch {}
        stream.resume();
        return;
      }

      // Ignore special entries (devices, FIFOs, pax headers, etc.).
      if (type !== 'file' && type !== 'contiguous-file') {
        stream.resume();
        return;
      }

      const declaredSize = Number(header?.size);
      const counted = limiter.checkEntry(
        normalized,
        Number.isFinite(declaredSize) ? declaredSize : 0
      );

      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      const writer = fsSync.createWriteStream(targetPath, { mode: FILE_MODE });
      let written = 0;
      stream.on('data', (chunk) => {
        written += chunk.length;
        if (limits?.maxEntryBytes && written > limits.maxEntryBytes) {
          stream.destroy(
            createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `archive entry too large (${normalized}).`)
          );
        }
      });

      await pipeline(stream, writer);

      if (written > counted) {
        limiter.addBytes(written - counted);
      }
      try { await fs.chmod(targetPath, FILE_MODE); } catch {}
    })()
      .then(() => next())
      .catch((err) => {
        try { stream.resume(); } catch {}
        extract.destroy(err);
      });
  });
  const source = fsSync.createReadStream(archivePath);
  if (gzip) {
    await pipeline(source, createGunzip(), extract);
  } else {
    await pipeline(source, extract);
  }
  return true;
}

async function extractArchiveNode(archivePath, destDir, type, limits) {
  if (type === 'zip') return extractZipNode(archivePath, destDir, limits);
  const gzip = type === 'tar.gz';
  return extractTarNode(archivePath, destDir, gzip, limits);
}

/**
 * Extract an archive into a destination directory.
 * @param {string} archivePath
 * @param {string} destDir
 * @param {string} type
 * @returns {boolean}
 */
async function extractArchive(archivePath, destDir, type, limits) {
  return extractArchiveNode(archivePath, destDir, type, limits);
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
 * Parse name=url inputs for extension downloads.
 * @param {string|string[]|null} input
 * @param {string} suffix
 * @returns {Array<{name:string,url:string,file:string}>}
 */
function parseUrls(input, suffix, hashes = null) {
  if (!input) return [];
  const items = Array.isArray(input) ? input : [input];
  const sources = [];
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq <= 0 || eq >= item.length - 1) continue;
    const name = item.slice(0, eq);
    const url = item.slice(eq + 1);
    const fileName = name.includes('.') ? name : `${name}${suffix}`;
    const sha256 = hashes && hashes[name] ? hashes[name] : null;
    sources.push({ name, url, file: fileName, sha256 });
  }
  return sources;
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

/**
 * Fetch a URL with redirect handling.
 * @param {string} url
 * @param {object} headers
 * @param {number} redirects
 * @returns {Promise<{statusCode:number,headers:object,body:Buffer}>}
 */
function requestUrl(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const handler = parsed.protocol === 'https:' ? https : http;
    const options = { method: 'GET', headers };
    const req = handler.request(parsed, options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect without location'));
        res.resume();
        return resolve(requestUrl(new URL(location, parsed).toString(), headers, redirects + 1));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const suffix = getBinarySuffix(config.platform);
const sources = parseUrls(argv.url, suffix, hashOverrides);
if (!sources.length) {
  const fallback = resolveSourceFromConfig(config);
  if (fallback?.url) sources.push(fallback);
}

if (!sources.length) {
  console.error('No extension sources configured. Use --url name=url or set sqlite.vectorExtension.url/downloads.');
  process.exit(1);
}

if (argv.out && sources.length > 1) {
  console.error('When using --out, provide exactly one source.');
  process.exit(1);
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
  const targetDir = path.join(extensionDir, config.provider, config.platformKey);
  await fs.mkdir(targetDir, { recursive: true });
  const archiveType = getArchiveTypeForSource(source);
  const fileName = archiveType ? config.filename : (source.file || config.filename);
  return path.join(targetDir, fileName);
}

/**
 * Download and extract a vector extension source.
 * @param {{name:string,url:string,file?:string}} source
 * @param {number} index
 * @returns {Promise<{name:string,skipped:boolean,outputPath:string}>}
 */
async function downloadSource(source, index) {
  const outputPath = await resolveOutputPath(source, index);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const key = `${source.name}:${config.platformKey}`;
  const entry = manifest[key] || {};
  const archiveType = getArchiveTypeForSource(source);
  const archiveSuffix = archiveType === 'tar.gz'
    ? '.tar.gz'
    : archiveType
      ? `.${archiveType}`
      : '';
  const tempRoot = path.join(extensionDir, '.tmp');
  const downloadPath = archiveType
    ? path.join(tempRoot, `${source.name}-${Date.now()}${archiveSuffix}`)
    : outputPath;

  if (!argv.force && !argv.update && fsSync.existsSync(outputPath)) {
    return { name: source.name, skipped: true, outputPath };
  }

  const headers = {};
  if (argv.update) {
    if (entry.etag) headers['If-None-Match'] = entry.etag;
    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  }

  const response = await requestUrl(source.url, headers);
  if (response.statusCode === 304) {
    return { name: source.name, skipped: true, outputPath };
  }
  if (response.statusCode !== 200) {
    throw new Error(`Failed to download ${source.url}: ${response.statusCode}`);
  }
  const expectedHash = resolveExpectedHash(source, downloadPolicy, hashOverrides);
  const actualHash = verifyDownloadHash(source, response.body, expectedHash, downloadPolicy);

  if (archiveType) {
    await fs.mkdir(tempRoot, { recursive: true });
  }
  await fs.writeFile(downloadPath, response.body, { mode: FILE_MODE });

  let extractedFrom = null;
  if (archiveType) {
    const extractDir = path.join(tempRoot, `extract-${Date.now()}`);
    await fs.mkdir(extractDir, { recursive: true });
    const ok = await extractArchive(downloadPath, extractDir, archiveType, archiveLimits);
    if (!ok) {
      throw new Error(`Failed to extract ${downloadPath} (${archiveType})`);
    }
    const extractedPath = await findFile(extractDir, config.filename, suffix);
    if (!extractedPath) {
      throw new Error(`No extension binary found in ${downloadPath}`);
    }
    await fs.copyFile(extractedPath, outputPath);
    try { await fs.chmod(outputPath, FILE_MODE); } catch {}
    extractedFrom = path.relative(extensionDir, extractedPath);
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.rm(downloadPath, { force: true });
  }

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
    verified: Boolean(expectedHash),
    etag: response.headers.etag || null,
    lastModified: response.headers['last-modified'] || null,
    downloadedAt: new Date().toISOString()
  };

  return { name: source.name, skipped: false, outputPath };
}

const results = [];
for (let i = 0; i < sources.length; i++) {
  const source = sources[i];
  try {
    results.push(await downloadSource(source, i));
  } catch (err) {
    console.error(String(err));
  }
}

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const downloaded = results.filter((r) => !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
const resolvedPath = resolveVectorExtensionPath(config);
if (resolvedPath && fsSync.existsSync(resolvedPath)) {
  console.log(`Extension present at ${resolvedPath}`);
}
console.log(`Done. downloaded=${downloaded} skipped=${skipped}`);
