import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';
import { prepareIsolatedTestCacheDir } from './test-cache.js';

export const createToolingDoctorTempRoot = async (name, { root = process.cwd() } = {}) => {
  const fixtureName = String(name || 'tooling-doctor').trim() || 'tooling-doctor';
  const { dir } = await prepareIsolatedTestCacheDir(fixtureName, {
    root,
    clean: true
  });
  return dir;
};

const toCommandSet = (value) => new Set(
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Build a deterministic command-profile resolver for doctor tests.
 *
 * @param {{
 *   available?: string[],
 *   missing?: string[],
 *   reject?: (input: {cmd: string, args: string[]}) => boolean
 * }} [options]
 * @returns {import('../../src/index/tooling/doctor.js').ToolingDoctorOptions['resolveCommandProfile']}
 */
export const createDoctorCommandResolver = (options = {}) => {
  const available = toCommandSet(options.available);
  const missing = toCommandSet(options.missing);
  const reject = typeof options.reject === 'function' ? options.reject : null;
  return ({ cmd, args = [] }) => {
    const normalizedCmd = String(cmd || '').trim().toLowerCase();
    const normalizedArgs = Array.isArray(args) ? args : [];
    const explicitlyAvailable = available.size === 0 || available.has(normalizedCmd);
    const explicitlyMissing = missing.has(normalizedCmd);
    const rejected = reject ? reject({ cmd: normalizedCmd, args: normalizedArgs }) : false;
    const ok = explicitlyAvailable && !explicitlyMissing && !rejected;
    return {
      requested: { cmd, args: normalizedArgs },
      resolved: {
        cmd,
        args: normalizedArgs,
        mode: 'direct',
        source: 'mock'
      },
      probe: {
        ok,
        attempted: [{ cmd, args: normalizedArgs }],
        resolvedPath: ok ? String(cmd) : null
      }
    };
  };
};

export const runToolingDoctorFixture = async ({
  tempRoot,
  enabledTools,
  providerIds = enabledTools,
  toolingConfig = {},
  strict = false,
  resolveCommandProfile,
  probeHandshake = false
}) => {
  registerDefaultToolingProviders();
  return runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      ...toolingConfig,
      enabledTools: Array.isArray(enabledTools) ? enabledTools : []
    },
    strict
  }, Array.isArray(providerIds) ? providerIds : [], {
    log: () => {},
    probeHandshake,
    resolveCommandProfile
  });
};

/**
 * Create a reusable doctor runner bound to one fixture root/config.
 *
 * @param {{
 *   tempRoot:string,
 *   enabledTools:string[],
 *   toolingConfig?:object,
 *   strict?:boolean,
 *   resolveCommandProfile?:Function,
 *   probeHandshake?:boolean
 * }} input
 * @returns {{tempRoot:string,runDoctor:(overrides?:object)=>Promise<any>}}
 */
export const createDoctorRunner = (input) => {
  const tempRoot = input?.tempRoot;
  const enabledTools = Array.isArray(input?.enabledTools) ? input.enabledTools : [];
  const toolingConfig = input?.toolingConfig || {};
  const strict = input?.strict === true;
  const resolveCommandProfile = input?.resolveCommandProfile;
  const probeHandshake = input?.probeHandshake === true;

  return {
    tempRoot,
    runDoctor: async (overrides = {}) => runToolingDoctorFixture({
      tempRoot,
      enabledTools,
      toolingConfig,
      strict,
      resolveCommandProfile,
      probeHandshake,
      ...overrides
    })
  };
};

const WORKSPACE_MARKER_BY_PROVIDER = {
  'csharp-ls': {
    relativePath: 'sample.sln',
    content: 'Microsoft Visual Studio Solution File\n'
  },
  dart: {
    relativePath: 'pubspec.yaml',
    content: 'name: fixture\n'
  },
  'elixir-ls': {
    relativePath: 'mix.exs',
    content: 'defmodule Test.MixProject do\nend\n'
  },
  'haskell-language-server': {
    relativePath: 'stack.yaml',
    content: 'resolver: lts-22.0\n'
  },
  phpactor: {
    relativePath: 'composer.json',
    content: '{"name":"fixture/app"}\n'
  },
  solargraph: {
    relativePath: 'Gemfile',
    content: "source 'https://rubygems.org'\n"
  },
  jdtls: {
    relativePath: 'pom.xml',
    content: '<project/>'
  },
  'lsp-java-dedicated': {
    relativePath: 'pom.xml',
    content: '<project/>'
  }
};

/**
 * Write a canonical workspace marker for a tooling provider fixture.
 *
 * @param {string} tempRoot
 * @param {string} providerId
 * @param {{relativePath?:string,content?:string}} [options]
 * @returns {Promise<string>}
 */
export const writeDoctorWorkspaceMarker = async (tempRoot, providerId, options = {}) => {
  const normalizedId = String(providerId || '').trim().toLowerCase();
  const mapping = WORKSPACE_MARKER_BY_PROVIDER[normalizedId] || null;
  if (!mapping && !options?.relativePath) {
    throw new Error(`No workspace marker mapping for providerId: ${providerId}`);
  }
  const relativePath = String(options?.relativePath || mapping?.relativePath || '').trim();
  if (!relativePath) {
    throw new Error(`Invalid workspace marker path for providerId: ${providerId}`);
  }
  const content = String(options?.content ?? mapping?.content ?? '');
  const targetPath = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
  return targetPath;
};
