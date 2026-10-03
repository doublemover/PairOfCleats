import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openContainedFileSync } from '../../src/shared/contained-file.js';
import { resolveDownloadPolicy, resolveExpectedHash } from '../shared/download-utils.js';

export const resolveExtensionSource = (config) => {
  const entry = config.downloads?.[config.platformKey]
    || config.downloads?.[`${config.platform}/${config.arch}`];
  return typeof entry === 'string' ? { url: entry }
    : { ...(entry || {}), url: entry?.url || config.url };
};

/** Recheck registered bytes at the native-loading sink, not just on download. */
export const assertTrustedExtension = (file, config, expectedBinaryHash = null) => {
  let expected = expectedBinaryHash;
  if (!expected) {
    const source = resolveExtensionSource(config);
    const approved = resolveExpectedHash({ ...source, name: config.provider, file: config.filename },
      config.downloadPolicy || {}, {});
    if (!source.url || !approved) throw new Error('Native extension has no user-approved source digest.');
    const manifestFile = path.join(config.dir, 'extensions.json');
    const manifestFd = openContainedFileSync(config.dir, manifestFile);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestFd, 'utf8')); } finally { fs.closeSync(manifestFd); }
    const record = manifest[`${config.provider}:${config.platformKey}`];
    if (!record?.verified || record.url !== source.url || record.sha256 !== approved
      || record.provider !== config.provider || record.platform !== config.platform || record.arch !== config.arch
      || path.resolve(config.dir, record.outputPath || '') !== path.resolve(file)) {
      throw new Error('Native extension registration does not match approved provider, platform and source.');
    }
    expected = record.outputSha256;
  }
  if (!/^[a-f0-9]{64}$/.test(String(expected || ''))) throw new Error('Native extension requires a valid SHA256 digest.');
  const root = expectedBinaryHash ? path.dirname(path.resolve(file)) : config.dir;
  const fd = openContainedFileSync(root, file);
  let actual;
  try { actual = crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex'); } finally { fs.closeSync(fd); }
  if (actual !== expected) throw new Error('Native extension checksum mismatch.');
  return actual;
};

export const extensionDownloadPolicy = (userConfig) => ({ ...resolveDownloadPolicy(userConfig), requireHash: true });
