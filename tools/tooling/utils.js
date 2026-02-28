import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { canRunCommand, probeCommand } from '../shared/cli-utils.js';
import { LOCK_FILES, MANIFEST_FILES, SKIP_DIRS, SKIP_FILES } from '../../src/index/constants.js';
import { findBinaryInDirs, splitPathEntries } from '../../src/index/tooling/binary-utils.js';
import { toPosix } from '../../src/shared/files.js';
import {
  normalizeEnvPathKeys as normalizeSharedEnvPathKeys,
  resolveEnvPath as resolveSharedEnvPath,
  resolvePathEnvKey as resolveSharedPathEnvKey
} from '../../src/shared/env-path.js';
import { getToolingConfig } from '../shared/dict-utils.js';

const LANGUAGE_EXTENSIONS = {
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  python: ['.py', '.pyi'],
  c: ['.c', '.h'],
  cpp: ['.cc', '.cpp', '.hpp', '.hh'],
  objc: ['.m', '.mm'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  dart: ['.dart'],
  swift: ['.swift'],
  elixir: ['.ex', '.exs'],
  haskell: ['.hs', '.lhs'],
  shell: ['.sh', '.bash', '.zsh', '.ksh'],
  csharp: ['.cs'],
  kotlin: ['.kt', '.kts'],
  ruby: ['.rb'],
  php: ['.php', '.phtml'],
  lua: ['.lua'],
  yaml: ['.yaml', '.yml'],
  zig: ['.zig'],
  sql: ['.sql', '.psql', '.pgsql', '.mysql', '.sqlite']
};

const FORMAT_EXTENSIONS = {
  json: ['.json'],
  toml: ['.toml'],
  ini: ['.ini', '.cfg', '.conf'],
  xml: ['.xml'],
  yaml: ['.yml', '.yaml'],
  rst: ['.rst'],
  asciidoc: ['.adoc', '.asciidoc']
};

const FORMAT_FILENAMES = {
  dockerfile: ['dockerfile'],
  makefile: ['makefile', 'gnumakefile'],
  manifest: Array.from(MANIFEST_FILES),
  lockfile: Array.from(LOCK_FILES)
};

const FORMAT_FILENAME_PREFIXES = {
  dockerfile: ['dockerfile.'],
  makefile: ['makefile.']
};

const TOOL_DOCS = {
  tsserver: 'https://www.typescriptlang.org/',
  'typescript-language-server': 'https://github.com/typescript-language-server/typescript-language-server',
  clangd: 'https://clangd.llvm.org/installation',
  'rust-analyzer': 'https://rust-analyzer.github.io/',
  gopls: 'https://pkg.go.dev/golang.org/x/tools/gopls',
  jdtls: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls',
  'elixir-ls': 'https://github.com/elixir-lsp/elixir-ls',
  'haskell-language-server': 'https://haskell-language-server.readthedocs.io/',
  dart: 'https://dart.dev/tools/dart-tool',
  'sourcekit-lsp': 'https://www.swift.org/download/',
  'kotlin-language-server': 'https://github.com/fwcd/kotlin-language-server',
  'kotlin-lsp': 'https://kotlinlang.org/docs/',
  pyright: 'https://github.com/microsoft/pyright',
  omnisharp: 'https://github.com/OmniSharp/omnisharp-roslyn',
  'csharp-ls': 'https://github.com/razzmatazz/csharp-language-server',
  'ruby-lsp': 'https://shopify.github.io/ruby-lsp/',
  solargraph: 'https://solargraph.org/',
  phpactor: 'https://phpactor.readthedocs.io/',
  intelephense: 'https://github.com/bmewburn/intelephense-docs',
  'bash-language-server': 'https://github.com/bash-lsp/bash-language-server',
  'lua-language-server': 'https://github.com/LuaLS/lua-language-server',
  'yaml-language-server': 'https://github.com/redhat-developer/yaml-language-server',
  zls: 'https://github.com/zigtools/zls',
  sqls: 'https://github.com/lighttiger2505/sqls'
};

const PREFERRED_TOOL_BY_LANGUAGE = {
  typescript: 'tsserver',
  csharp: 'csharp-ls',
  ruby: 'solargraph',
  php: 'phpactor',
  kotlin: 'kotlin-lsp'
};

function canRun(cmd, args = ['--version']) {
  return canRunCommand(cmd, args);
}

function dedupePaths(paths = []) {
  const seen = new Set();
  const normalized = [];
  for (const entry of paths) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function resolvePathEnvKey(env, options = {}) {
  return resolveSharedPathEnvKey(env, options);
}

export function resolveEnvPath(env) {
  return resolveSharedEnvPath(env);
}

export function normalizeEnvPathKeys(env, options = {}) {
  return normalizeSharedEnvPathKeys(env, options);
}

export function prependPathEntries(env, entries, options = {}) {
  if (!env || typeof env !== 'object') return '';
  const nextEntries = Array.isArray(entries)
    ? entries
    : [entries];
  const normalizedEntries = dedupePaths(nextEntries.map((entry) => String(entry || '').trim()).filter(Boolean));
  const normalizedPathState = normalizeEnvPathKeys(env, options);
  const currentEntries = splitPathEntries(normalizedPathState.value);
  const mergedEntries = dedupePaths([...normalizedEntries, ...currentEntries]);
  env[normalizedPathState.key] = mergedEntries.join(path.delimiter);
  return env[normalizedPathState.key];
}

export function buildTestRuntimeEnv(baseEnv = process.env, overrides = null) {
  const env = { ...(baseEnv && typeof baseEnv === 'object' ? baseEnv : {}) };
  if (overrides && typeof overrides === 'object') {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === null) {
        delete env[key];
      } else {
        env[key] = String(value);
      }
    }
  }
  env.PAIROFCLEATS_TESTING = '1';
  normalizeEnvPathKeys(env);
  return env;
}

function resolveHomeDir() {
  const home = process.platform === 'win32'
    ? (process.env.USERPROFILE || process.env.HOME || '')
    : (process.env.HOME || process.env.USERPROFILE || '');
  return String(home || '').trim();
}

function expandRubyVersionBinDirs(baseDir) {
  const root = path.join(baseDir, 'ruby');
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'bin'));
}

function resolveGlobalDotnetBinDirs() {
  const home = resolveHomeDir();
  if (!home) return [];
  return [path.join(home, '.dotnet', 'tools')];
}

function resolveGlobalComposerBinDirs() {
  const home = resolveHomeDir();
  const appData = String(process.env.APPDATA || '').trim();
  const xdgConfigHome = String(process.env.XDG_CONFIG_HOME || '').trim();
  return dedupePaths([
    appData ? path.join(appData, 'Composer', 'vendor', 'bin') : '',
    xdgConfigHome ? path.join(xdgConfigHome, 'composer', 'vendor', 'bin') : '',
    home ? path.join(home, '.config', 'composer', 'vendor', 'bin') : '',
    home ? path.join(home, '.composer', 'vendor', 'bin') : ''
  ]);
}

function resolveGlobalPhpactorBinDirs() {
  const home = resolveHomeDir();
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  return dedupePaths([
    localAppData ? path.join(localAppData, 'Programs', 'phpactor') : '',
    home ? path.join(home, '.local', 'bin') : ''
  ]);
}

function resolveGlobalGemBinDirs() {
  const home = resolveHomeDir();
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  const gemHome = String(process.env.GEM_HOME || '').trim();
  const gemPathEntries = splitPathEntries(process.env.GEM_PATH || '');
  const userGemRoots = [
    home ? path.join(home, '.local', 'share', 'gem') : '',
    home ? path.join(home, '.gem') : ''
  ].filter(Boolean);
  const versionedGemBins = userGemRoots.flatMap((root) => expandRubyVersionBinDirs(root));
  return dedupePaths([
    localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps') : '',
    gemHome ? path.join(gemHome, 'bin') : '',
    ...gemPathEntries.map((entry) => path.join(entry, 'bin')),
    ...versionedGemBins
  ]);
}

function resolveDetectArgCandidates(tool) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (args) => {
    if (!Array.isArray(args) || !args.length) return;
    const normalizedArgs = args.map((arg) => String(arg));
    const key = JSON.stringify(normalizedArgs);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalizedArgs);
  };
  addCandidate(tool?.detect?.args || ['--version']);
  addCandidate(['--version']);
  addCandidate(['version']);
  return candidates;
}

function probeWithArgCandidates(cmd, argCandidates) {
  const attempts = [];
  for (const args of argCandidates) {
    const probe = probeCommand(cmd, args, { timeoutMs: 4000 });
    attempts.push({
      args,
      outcome: probe.outcome,
      status: probe.status,
      signal: probe.signal,
      errorCode: probe.errorCode
    });
    if (probe.ok) {
      return {
        ok: true,
        outcome: 'ok',
        attempts
      };
    }
  }
  const preferred = attempts.find((entry) => entry.outcome === 'missing')
    ? 'missing'
    : (attempts.find((entry) => entry.outcome === 'timeout')
      ? 'timeout'
      : (attempts[0]?.outcome || 'inconclusive'));
  return {
    ok: false,
    outcome: preferred,
    attempts
  };
}

async function scanRepo(root) {
  const extCounts = new Map();
  const lowerNames = new Set();
  let workflowCount = 0;
  const visit = async (dir) => {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext) extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
      lowerNames.add(entry.name.toLowerCase());
      const normalized = toPosix(abs).toLowerCase();
      if (normalized.includes('/.github/workflows/')
        && (normalized.endsWith('.yml') || normalized.endsWith('.yaml'))) {
        workflowCount += 1;
      }
    }
  };
  await visit(root);
  return { extCounts, lowerNames, workflowCount };
}

function buildLangHits(extCounts) {
  const hits = {};
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    const matched = exts.filter((ext) => extCounts.has(ext));
    if (!matched.length) continue;
    const count = matched.reduce((sum, ext) => sum + (extCounts.get(ext) || 0), 0);
    hits[lang] = { extensions: matched, files: count };
  }
  return hits;
}

function buildFormatHits(extCounts, lowerNames, workflowCount) {
  const hits = {};
  const hasPrefixName = (prefix) => {
    const key = prefix.toLowerCase();
    if (lowerNames.has(key)) return true;
    for (const name of lowerNames) {
      if (name.startsWith(key)) return true;
    }
    return false;
  };
  for (const [format, exts] of Object.entries(FORMAT_EXTENSIONS)) {
    const matched = exts.filter((ext) => extCounts.has(ext));
    if (!matched.length) continue;
    const count = matched.reduce((sum, ext) => sum + (extCounts.get(ext) || 0), 0);
    hits[format] = { extensions: matched, files: count };
  }
  for (const [format, names] of Object.entries(FORMAT_FILENAMES)) {
    const prefixes = FORMAT_FILENAME_PREFIXES[format] || [];
    const hasExact = names.some((name) => lowerNames.has(name));
    const hasPrefix = prefixes.some((prefix) => hasPrefixName(prefix));
    if (hasExact || hasPrefix) {
      hits[format] = { filenames: names, files: names.length };
    }
  }
  if (workflowCount) {
    hits['github-actions'] = { extensions: ['.yml', '.yaml'], files: workflowCount };
  }
  return hits;
}

export async function detectRepoLanguages(root) {
  const { extCounts, lowerNames, workflowCount } = await scanRepo(root);
  const languages = buildLangHits(extCounts);
  const formats = buildFormatHits(extCounts, lowerNames, workflowCount);
  return { languages, formats, extCounts };
}

export function getToolingRegistry(toolingRoot, repoRoot) {
  const nodeDir = path.join(toolingRoot, 'node');
  const nodeBin = path.join(nodeDir, 'node_modules', '.bin');
  const repoNodeBin = path.join(repoRoot, 'node_modules', '.bin');
  const binDir = path.join(toolingRoot, 'bin');
  const dotnetDir = path.join(toolingRoot, 'dotnet');
  const gemsDir = path.join(toolingRoot, 'gems');
  const composerDir = path.join(toolingRoot, 'composer');
  const composerBin = path.join(composerDir, 'vendor', 'bin');
  const globalDotnetBins = resolveGlobalDotnetBinDirs();
  const globalGemBins = resolveGlobalGemBinDirs();
  const globalComposerBins = resolveGlobalComposerBinDirs();
  const globalPhpactorBins = resolveGlobalPhpactorBinDirs();

  return [
    {
      id: 'tsserver',
      label: 'TypeScript server',
      languages: ['typescript'],
      detect: { cmd: 'tsserver', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'typescript'] },
        user: { cmd: 'npm', args: ['install', '-g', 'typescript'] }
      },
      docs: TOOL_DOCS.tsserver
    },
    {
      id: 'typescript-language-server',
      label: 'TypeScript language server',
      languages: ['typescript'],
      detect: { cmd: 'typescript-language-server', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'typescript-language-server'] },
        user: { cmd: 'npm', args: ['install', '-g', 'typescript-language-server'] }
      },
      docs: TOOL_DOCS['typescript-language-server']
    },
    {
      id: 'clangd',
      label: 'clangd',
      languages: ['c', 'cpp', 'objc'],
      detect: { cmd: 'clangd', args: ['--version'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS.clangd
    },
    {
      id: 'sourcekit-lsp',
      label: 'SourceKit-LSP',
      languages: ['swift'],
      detect: { cmd: 'sourcekit-lsp', args: ['--help'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['sourcekit-lsp']
    },
    {
      id: 'pyright',
      label: 'Pyright',
      languages: ['python'],
      detect: { cmd: 'pyright-langserver', args: ['--help'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'pyright'] },
        user: { cmd: 'npm', args: ['install', '-g', 'pyright'] }
      },
      docs: TOOL_DOCS.pyright
    },
    {
      id: 'rust-analyzer',
      label: 'rust-analyzer',
      languages: ['rust'],
      detect: { cmd: 'rust-analyzer', args: ['--version'], binDirs: [] },
      install: {
        user: { cmd: 'rustup', args: ['component', 'add', 'rust-analyzer'], requires: 'rustup' }
      },
      docs: TOOL_DOCS['rust-analyzer']
    },
    {
      id: 'gopls',
      label: 'gopls',
      languages: ['go'],
      detect: { cmd: 'gopls', args: ['version'], binDirs: [binDir] },
      install: {
        cache: { cmd: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'], env: { GOBIN: binDir }, requires: 'go' },
        user: { cmd: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'], requires: 'go' }
      },
      docs: TOOL_DOCS.gopls
    },
    {
      id: 'jdtls',
      label: 'jdtls',
      languages: ['java'],
      detect: { cmd: 'jdtls', args: ['--help'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS.jdtls
    },
    {
      id: 'elixir-ls',
      label: 'elixir-ls',
      languages: ['elixir'],
      detect: { cmd: 'elixir-ls', args: ['--help'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['elixir-ls']
    },
    {
      id: 'haskell-language-server',
      label: 'haskell-language-server',
      languages: ['haskell'],
      detect: { cmd: 'haskell-language-server', args: ['--version'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['haskell-language-server']
    },
    {
      id: 'dart',
      label: 'Dart SDK language server',
      languages: ['dart'],
      detect: { cmd: 'dart', args: ['--version'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS.dart
    },
    {
      id: 'kotlin-language-server',
      label: 'kotlin-language-server',
      languages: ['kotlin'],
      detect: { cmd: 'kotlin-language-server', args: ['--version'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['kotlin-language-server']
    },
    {
      id: 'kotlin-lsp',
      label: 'Kotlin LSP',
      languages: ['kotlin'],
      detect: { cmd: 'kotlin-lsp', args: ['--version'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['kotlin-lsp']
    },
    {
      id: 'omnisharp',
      label: 'OmniSharp',
      languages: ['csharp'],
      detect: { cmd: 'omnisharp', args: ['--version'], binDirs: [dotnetDir, ...globalDotnetBins] },
      install: {
        cache: { cmd: 'dotnet', args: ['tool', 'install', '--tool-path', dotnetDir, 'omnisharp'], requires: 'dotnet' },
        user: { cmd: 'dotnet', args: ['tool', 'install', '-g', 'omnisharp'], requires: 'dotnet' }
      },
      docs: TOOL_DOCS.omnisharp
    },
    {
      id: 'csharp-ls',
      label: 'C# LSP (Roslyn)',
      languages: ['csharp'],
      detect: { cmd: 'csharp-ls', args: ['--version'], binDirs: [dotnetDir, ...globalDotnetBins] },
      install: {
        cache: { cmd: 'dotnet', args: ['tool', 'install', '--tool-path', dotnetDir, 'csharp-ls'], requires: 'dotnet' },
        user: { cmd: 'dotnet', args: ['tool', 'install', '-g', 'csharp-ls'], requires: 'dotnet' }
      },
      docs: TOOL_DOCS['csharp-ls']
    },
    {
      id: 'ruby-lsp',
      label: 'Ruby LSP',
      languages: ['ruby'],
      detect: { cmd: 'ruby-lsp', args: ['--version'], binDirs: [binDir, ...globalGemBins] },
      install: {
        cache: { cmd: 'gem', args: ['install', '-i', gemsDir, '-n', binDir, 'ruby-lsp'], requires: 'gem' },
        user: { cmd: 'gem', args: ['install', 'ruby-lsp'], requires: 'gem' }
      },
      docs: TOOL_DOCS['ruby-lsp']
    },
    {
      id: 'solargraph',
      label: 'Solargraph',
      languages: ['ruby'],
      detect: { cmd: 'solargraph', args: ['--version'], binDirs: [binDir, ...globalGemBins] },
      install: {
        cache: { cmd: 'gem', args: ['install', '-i', gemsDir, '-n', binDir, 'solargraph'], requires: 'gem' },
        user: { cmd: 'gem', args: ['install', 'solargraph'], requires: 'gem' }
      },
      docs: TOOL_DOCS.solargraph
    },
    {
      id: 'phpactor',
      label: 'phpactor',
      languages: ['php'],
      detect: { cmd: 'phpactor', args: ['--version'], binDirs: [binDir, composerBin, ...globalComposerBins, ...globalPhpactorBins] },
      install: {
        cache: {
          cmd: process.execPath,
          args: [path.join(repoRoot, 'tools', 'tooling', 'install-phpactor-phar.js'), '--scope', 'cache', '--tooling-root', toolingRoot],
          requires: 'php'
        },
        user: {
          cmd: process.execPath,
          args: [path.join(repoRoot, 'tools', 'tooling', 'install-phpactor-phar.js'), '--scope', 'user'],
          requires: 'php'
        }
      },
      docs: TOOL_DOCS.phpactor
    },
    {
      id: 'intelephense',
      label: 'Intelephense',
      languages: ['php'],
      detect: { cmd: 'intelephense', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'intelephense'] },
        user: { cmd: 'npm', args: ['install', '-g', 'intelephense'] }
      },
      docs: TOOL_DOCS.intelephense
    },
    {
      id: 'lua-language-server',
      label: 'lua-language-server',
      languages: ['lua'],
      detect: { cmd: 'lua-language-server', args: ['-v'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['lua-language-server']
    },
    {
      id: 'yaml-language-server',
      label: 'yaml-language-server',
      languages: ['yaml'],
      detect: { cmd: 'yaml-language-server', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'yaml-language-server'] },
        user: { cmd: 'npm', args: ['install', '-g', 'yaml-language-server'] }
      },
      docs: TOOL_DOCS['yaml-language-server']
    },
    {
      id: 'zls',
      label: 'zls',
      languages: ['zig'],
      detect: { cmd: 'zls', args: ['--version'], binDirs: [binDir] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS.zls
    },
    {
      id: 'bash-language-server',
      label: 'bash-language-server',
      languages: ['shell'],
      detect: { cmd: 'bash-language-server', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'bash-language-server'] },
        user: { cmd: 'npm', args: ['install', '-g', 'bash-language-server'] }
      },
      docs: TOOL_DOCS['bash-language-server']
    },
    {
      id: 'sqls',
      label: 'sqls',
      languages: ['sql'],
      detect: { cmd: 'sqls', args: ['version'], binDirs: [binDir] },
      install: {
        cache: { cmd: 'go', args: ['install', 'github.com/lighttiger2505/sqls@latest'], env: { GOBIN: binDir }, requires: 'go' },
        user: { cmd: 'go', args: ['install', 'github.com/lighttiger2505/sqls@latest'], requires: 'go' }
      },
      docs: TOOL_DOCS.sqls
    }
  ];
}

function filterToolsByConfig(tools, toolingConfig) {
  const enabled = Array.isArray(toolingConfig?.enabledTools) ? toolingConfig.enabledTools : [];
  const disabled = Array.isArray(toolingConfig?.disabledTools) ? toolingConfig.disabledTools : [];
  let filtered = tools;
  if (enabled.length) {
    const enabledSet = new Set(enabled);
    filtered = filtered.filter((tool) => enabledSet.has(tool.id));
  }
  if (disabled.length) {
    const disabledSet = new Set(disabled);
    filtered = filtered.filter((tool) => !disabledSet.has(tool.id));
  }
  return filtered;
}

export function resolveToolsForLanguages(languages, toolingRoot, repoRoot, toolingConfig = null) {
  const registry = getToolingRegistry(toolingRoot, repoRoot);
  const selected = new Set();
  const normalizedLanguages = Array.isArray(languages)
    ? languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  for (const language of normalizedLanguages) {
    const candidates = registry.filter((tool) => tool.languages.some((lang) => String(lang || '').toLowerCase() === language));
    if (!candidates.length) continue;
    const preferredToolId = PREFERRED_TOOL_BY_LANGUAGE[language] || '';
    const preferred = preferredToolId
      ? candidates.find((tool) => tool.id === preferredToolId)
      : null;
    selected.add((preferred || candidates[0]).id);
  }
  const matched = registry.filter((tool) => selected.has(tool.id));
  return filterToolsByConfig(matched, toolingConfig);
}

export function resolveToolsById(ids, toolingRoot, repoRoot, toolingConfig = null) {
  const idSet = new Set(ids);
  const registry = getToolingRegistry(toolingRoot, repoRoot);
  const matched = registry.filter((tool) => idSet.has(tool.id));
  return filterToolsByConfig(matched, toolingConfig);
}

export function detectTool(tool) {
  const detectCmd = String(tool?.detect?.cmd || '');
  const isPyrightLangserver = detectCmd.toLowerCase() === 'pyright-langserver';
  const detectArgCandidates = resolveDetectArgCandidates(tool);
  const binDirs = tool.detect?.binDirs || [];
  const binPath = binDirs.length ? findBinaryInDirs(tool.detect.cmd, binDirs) : null;
  if (binPath) {
    const probe = probeWithArgCandidates(binPath, detectArgCandidates);
    const ok = probe.ok === true;
    if (ok || (isPyrightLangserver && fs.existsSync(binPath))) {
      return { found: true, path: binPath, source: 'cache', probe };
    }
    if (!ok && isPyrightLangserver && fs.existsSync(binPath)) {
      return { found: true, path: binPath, source: 'cache', probe };
    }
  }
  const probe = probeWithArgCandidates(tool.detect.cmd, detectArgCandidates);
  const ok = probe.ok === true;
  if (ok) return { found: true, path: tool.detect.cmd, source: 'path', probe };
  if (isPyrightLangserver) {
    const pathEntries = splitPathEntries(resolveEnvPath(process.env));
    const pathFound = findBinaryInDirs(tool.detect.cmd, pathEntries);
    if (pathFound && fs.existsSync(pathFound)) {
      return { found: true, path: pathFound, source: 'path', probe };
    }
  }
  return { found: false, path: null, source: null, probe };
}

export function selectInstallPlan(tool, scope, allowFallback) {
  const install = tool.install || {};
  const normalizedScope = scope || 'cache';
  if (install[normalizedScope]) {
    return { scope: normalizedScope, plan: install[normalizedScope] };
  }
  if (!allowFallback) return { scope: normalizedScope, plan: null };
  const fallbackScope = install.cache ? 'cache' : (install.user ? 'user' : (install.system ? 'system' : null));
  if (!fallbackScope) return { scope: normalizedScope, plan: null };
  return { scope: fallbackScope, plan: install[fallbackScope], fallback: true };
}

export function hasCommand(cmd) {
  return canRun(cmd, ['--version']);
}

export async function buildToolingReport(root, languageOverride = null, options = {}) {
  const toolingConfig = getToolingConfig(root);
  const skipScan = options.skipScan === true;
  const detected = skipScan ? { languages: {}, formats: {} } : await detectRepoLanguages(root);
  const languages = detected.languages || {};
  const formats = detected.formats || {};
  const languageList = languageOverride && languageOverride.length
    ? languageOverride
    : Object.keys(languages);
  const languageMap = (languageOverride && languageOverride.length && skipScan)
    ? languageOverride.reduce((acc, lang) => {
      acc[lang] = { extensions: [], files: 0, override: true };
      return acc;
    }, {})
    : languages;
  const tools = resolveToolsForLanguages(languageList, toolingConfig.dir, root, toolingConfig).map((tool) => {
    const status = detectTool(tool);
    return {
      id: tool.id,
      label: tool.label,
      docs: tool.docs,
      languages: tool.languages,
      found: status.found,
      source: status.source,
      path: status.path,
      probe: status.probe || null,
      install: tool.install || {}
    };
  });
  return {
    root,
    toolingRoot: toolingConfig.dir,
    languages: languageMap,
    formats,
    tools
  };
}

export function normalizeLanguageList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
