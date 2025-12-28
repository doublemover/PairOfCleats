#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import { loadUserConfig } from './dict-utils.js';
import { getBinarySuffix, getPlatformKey, getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['update', 'force'],
  string: ['provider', 'dir', 'url', 'out', 'platform', 'arch'],
  default: { update: false, force: false }
});

const repoRoot = process.cwd();
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

function getArchiveType(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

function getArchiveTypeForSource(source) {
  return getArchiveType(source.file) || getArchiveType(source.url);
}

function runCommand(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  return result.status === 0;
}

function extractArchive(archivePath, destDir, type) {
  if (type === 'zip') {
    if (runCommand('unzip', ['-o', archivePath, '-d', destDir])) return true;
    if (runCommand('tar', ['-xf', archivePath, '-C', destDir])) return true;
    if (process.platform === 'win32') {
      const script = `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${destDir}" -Force`;
      if (runCommand('powershell', ['-NoProfile', '-Command', script])) return true;
      if (runCommand('pwsh', ['-NoProfile', '-Command', script])) return true;
    }
    return false;
  }
  const tarArgs = type === 'tar.gz'
    ? ['-xzf', archivePath, '-C', destDir]
    : ['-xf', archivePath, '-C', destDir];
  return runCommand('tar', tarArgs);
}

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

function parseUrls(input, suffix) {
  if (!input) return [];
  const items = Array.isArray(input) ? input : [input];
  const sources = [];
  for (const item of items) {
    const [name, url] = item.split('=');
    if (!name || !url) continue;
    const fileName = name.includes('.') ? name : `${name}${suffix}`;
    sources.push({ name, url, file: fileName });
  }
  return sources;
}

function resolveSourceFromConfig(cfg) {
  const downloads = cfg.downloads || {};
  const byPlatform = downloads[cfg.platformKey]
    || downloads[getPlatformKey(cfg.platform, cfg.arch)]
    || downloads[`${cfg.platform}/${cfg.arch}`];
  if (byPlatform && typeof byPlatform === 'object') {
    return {
      name: cfg.provider,
      url: byPlatform.url,
      file: byPlatform.file || cfg.filename
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
const sources = parseUrls(argv.url, suffix);
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

async function resolveOutputPath(source, index) {
  if (argv.out) return path.resolve(argv.out);
  if (config.path && index === 0) return config.path;
  const targetDir = path.join(extensionDir, config.provider, config.platformKey);
  await fs.mkdir(targetDir, { recursive: true });
  const archiveType = getArchiveTypeForSource(source);
  const fileName = archiveType ? config.filename : (source.file || config.filename);
  return path.join(targetDir, fileName);
}

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

  if (archiveType) {
    await fs.mkdir(tempRoot, { recursive: true });
  }
  await fs.writeFile(downloadPath, response.body);

  let extractedFrom = null;
  if (archiveType) {
    const extractDir = path.join(tempRoot, `extract-${Date.now()}`);
    await fs.mkdir(extractDir, { recursive: true });
    const ok = extractArchive(downloadPath, extractDir, archiveType);
    if (!ok) {
      throw new Error(`Failed to extract ${downloadPath} (${archiveType})`);
    }
    const extractedPath = await findFile(extractDir, config.filename, suffix);
    if (!extractedPath) {
      throw new Error(`No extension binary found in ${downloadPath}`);
    }
    await fs.copyFile(extractedPath, outputPath);
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
