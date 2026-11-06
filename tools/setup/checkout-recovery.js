import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileResourceBytesSync } from '../../src/shared/file-read-resource.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { BOOTSTRAP_RECEIPT, BOOTSTRAP_RECEIPT_VERSION, captureBootstrapInputs } from '../../src/shared/bootstrap-readiness.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';

const LIMITS = Object.freeze({ packages: 8192, bytes: 32 * 1024 * 1024, fileBytes: 1024 * 1024, lockBytes: 8 * 1024 * 1024 });
const problem = (code, message) => Object.assign(new Error(message), { code });
const entries = value => Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const applicable = (list, current) => !Array.isArray(list) || !list.length || !list.includes('!' + current)
  && (!list.some(value => !value.startsWith('!')) || list.includes(current) || list.includes('any'));
const commands = Object.freeze({ verify: 'npm run bootstrap:ci -- --verify', repair: 'npm run bootstrap:ci -- --repair',
  install: 'npm run bootstrap:ci', wait: null, 'select-runtime': null });

/** Read-only recovery selection, never native qualification or a resume token.
 * The current lock and actual installed manifests select the smallest complete
 * existing operation. No stage is skipped because a prior journal says done.
 */
export const inspectCheckoutRecovery = ({ root, readiness, inputs = null } = {}) => {
  const result = (action, reason, details = {}) => Object.freeze({ schemaVersion: 1, kind: 'checkout-bootstrap-recovery',
    action, command: commands[action], reason, qualification: 'metadata-only-reinspection-not-native-qualification', ...details });
  if (readiness?.ready) return result('verify', 'Current readiness is intact; repeat complete verification without reinstalling.');
  if (['ERR_BOOTSTRAP_MUTATION_ACTIVE', 'ERR_BOOTSTRAP_RECEIPT_REPLACED', 'ERR_BOOTSTRAP_JOURNAL_REPLACED'].includes(readiness?.code)) return result(
    'wait', 'The original mutation or inspection must finish; no lock stealing or work replay is authorized.');
  if (readiness?.code === 'ERR_BOOTSTRAP_RUNTIME_UNSUPPORTED') return result('select-runtime', 'Select the supported .nvmrc runtime before preparing this checkout.');
  let checkedPackages = 0, readBytes = 0;
  const files = new Map(), directories = new Map();
  try {
    root = fs.realpathSync(root);
    const checkPath = relative => {
      if (typeof relative !== 'string' || relative.includes('\\') || path.isAbsolute(relative)
        || relative.split('/').some(part => !part || part === '.' || part === '..')) throw problem('ERR_CHECKOUT_RECOVERY_PATH', 'Recovery input is outside its application checkout.');
      let parent = root;
      for (const part of relative.split('/').slice(0, -1)) {
        parent = path.join(parent, part);
        const actual = fs.lstatSync(parent, { bigint: true });
        if (!actual.isDirectory() || actual.isSymbolicLink()) throw problem('ERR_CHECKOUT_RECOVERY_PATH', 'Recovery requires ordinary installed dependency directories.');
        const original = directories.get(parent);
        if (original && (actual.dev !== original.dev || actual.ino !== original.ino)) throw problem('ERR_CHECKOUT_RECOVERY_CHANGED', 'Recovery dependency directory changed during inspection.');
        directories.set(parent, actual);
      }
      return path.join(root, relative);
    };
    const read = (relative, limit = LIMITS.fileBytes) => {
      const target = checkPath(relative), identity = persistenceFileIdentity(fs.lstatSync(target, { bigint: true }));
      const data = readFileResourceBytesSync(target, stat => {
        if (stat.size > limit || readBytes + stat.size > LIMITS.bytes) throw problem('ERR_CHECKOUT_RECOVERY_BOUND', 'Recovery manifest inspection exhausted its finite byte budget.');
      }, stat => assertPersistenceFileIdentity(stat, identity));
      readBytes += data.length; files.set(target, identity);
      assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), identity);
      return JSON.parse(data.toString('utf8'));
    };
    const manifest = read('package.json'), lock = read('package-lock.json', LIMITS.lockBytes);
    if (lock.lockfileVersion !== 3 || !lock.packages || !lock.packages['']) throw problem('ERR_CHECKOUT_RECOVERY_LOCK', 'Current locked dependency inventory is missing or unsupported.');
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) if (!same(entries(manifest[field]), entries(lock.packages[''][field]))) throw problem(
      'ERR_CHECKOUT_RECOVERY_LOCK', 'Current package declarations differ from the locked inventory.');
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
    const rootRequired = new Set(declared.map(name => 'node_modules/' + name));
    const packages = Object.entries(lock.packages);
    if (packages.length > LIMITS.packages) throw problem('ERR_CHECKOUT_RECOVERY_BOUND', 'Recovery package inventory exceeds its finite bound.');
    for (const relative of rootRequired) if (!lock.packages[relative]) throw problem('ERR_CHECKOUT_RECOVERY_LOCK', 'A declared dependency has no locked installed identity: ' + relative);
    for (const [relative, expected] of packages) {
      if (!relative || !applicable(expected.os, process.platform) || !applicable(expected.cpu, process.arch)
        || expected.optional === true && !rootRequired.has(relative)) continue;
      if (!relative.startsWith('node_modules/') || expected.link || typeof expected.version !== 'string') throw problem(
        'ERR_CHECKOUT_RECOVERY_LOCK', 'Recovery cannot qualify this locked package layout: ' + relative);
      const installed = read(relative + '/package.json'); checkedPackages++;
      if (installed.version !== expected.version || typeof expected.name === 'string' && installed.name !== expected.name) throw problem(
        'ERR_CHECKOUT_RECOVERY_PACKAGE', 'Installed dependency differs from its locked version: ' + relative);
    }
    // A current-format historical receipt may select verify-only from exact
    // installed artifact metadata and unchanged required patch inputs. It still
    // cannot admit normal work or replace the complete native/patch verifier.
    let intact = false;
    try {
      const receipt = read(BOOTSTRAP_RECEIPT, LIMITS.lockBytes), currentInputs = inputs || captureBootstrapInputs(root);
      const patches = rows => rows.filter(([relative]) => relative.startsWith('patches/'));
      intact = receipt.schemaVersion === BOOTSTRAP_RECEIPT_VERSION && receipt.root === root
        && Array.isArray(receipt.artifacts) && receipt.artifacts.length > 0 && receipt.artifacts.length <= 10000
        && same(receipt.declared, declared) && Array.isArray(receipt.inputs) && same(patches(receipt.inputs), patches(currentInputs))
        && receipt.verification?.generationId === createHash('sha256').update(JSON.stringify({ root: receipt.root, runtime: receipt.runtime,
          inputs: receipt.inputs, declared: receipt.declared, artifacts: receipt.artifacts })).digest('hex');
      if (intact) for (const [relative, expected] of receipt.artifacts) {
        if (!relative.startsWith('node_modules/')) throw problem('ERR_CHECKOUT_RECOVERY_PATH', 'Receipt artifact lies outside the dependency tree.');
        const target = checkPath(relative), actual = fs.lstatSync(target);
        if (!actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 || !same([actual.size, actual.mtimeMs, actual.ctimeMs, actual.mode], expected)) {
          intact = false; break;
        }
        const sealed = fs.lstatSync(target, { bigint: true });
        if (files.has(target)) assertPersistenceFileIdentity(sealed, files.get(target));
        else files.set(target, persistenceFileIdentity(sealed));
      }
    } catch (error) {
      // Original contained-read resources must retire even when historical
      // metadata is malformed or absent; unknown work is not an install hint.
      observeStorageResource(error, { phase: 'checkout-recovery-historical-read' }).requireSettled();
      intact = false;
    }
    for (const [target, identity] of files) assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), identity);
    for (const [target, original] of directories) {
      const actual = fs.lstatSync(target, { bigint: true });
      if (!actual.isDirectory() || actual.isSymbolicLink() || actual.dev !== original.dev || actual.ino !== original.ino) throw problem(
        'ERR_CHECKOUT_RECOVERY_CHANGED', 'Recovery directory changed before its plan completed.');
    }
    return result(intact ? 'verify' : 'repair', intact ? 'Locked dependencies and recorded native/patch artifacts remain intact; refresh complete verification.'
      : 'Locked package versions are present; apply required patches and use targeted native repair before fresh verification.', { checkedPackages, readBytes });
  } catch (error) {
    observeStorageResource(error, { phase: 'checkout-recovery-input-read' }).requireSettled();
    return result('install', 'A complete locked dependency tree could not be established; inspect the reported input before locked installation.', {
      checkedPackages, readBytes, blocker: { code: readErrorDataProperty(error, 'code') || 'ERR_CHECKOUT_RECOVERY_INPUT',
        message: readErrorDataProperty(error, 'message') || 'Recovery metadata inspection failed.' } });
  }
};
