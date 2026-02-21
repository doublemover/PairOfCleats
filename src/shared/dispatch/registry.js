const entry = (id, commandPath, script, description, extras = {}) => Object.freeze({
  id,
  commandPath: Object.freeze(commandPath.slice()),
  script,
  description,
  progressMode: extras.progressMode || 'jsonl',
  expectedArtifacts: Object.freeze(Array.isArray(extras.expectedArtifacts) ? extras.expectedArtifacts.slice() : []),
  metadata: Object.freeze(extras.metadata && typeof extras.metadata === 'object' ? { ...extras.metadata } : {})
});

export const DISPATCH_REGISTRY = Object.freeze([
  entry('search', ['search'], 'search.js', 'Query indexed data.', {
    expectedArtifacts: ['metrics:search'],
    metadata: {
      backendEnum: ['auto', 'sqlite', 'sqlite-fts', 'fts', 'lmdb', 'tantivy', 'memory']
    }
  }),
  entry('index.build', ['index', 'build'], 'build_index.js', 'Build file-backed indexes.', {
    expectedArtifacts: ['index:code', 'index:prose', 'index:records']
  }),
  entry('index.watch', ['index', 'watch'], 'build_index.js', 'Watch and rebuild indexes.', {
    expectedArtifacts: ['index:code', 'index:prose', 'index:records']
  }),
  entry('index.validate', ['index', 'validate'], 'tools/index/validate.js', 'Validate index artifacts.'),
  entry('setup', ['setup'], 'tools/setup/setup.js', 'Guided setup flow.', {
    expectedArtifacts: ['config:file', 'cache:dicts', 'cache:models']
  }),
  entry('bootstrap', ['bootstrap'], 'tools/setup/bootstrap.js', 'Fast bootstrap flow.', {
    expectedArtifacts: ['config:file', 'cache:dicts', 'cache:models', 'index:code', 'index:prose', 'index:records']
  }),
  entry('workspace.manifest', ['workspace', 'manifest'], 'tools/workspace/manifest.js', 'Generate workspace manifest.'),
  entry('workspace.status', ['workspace', 'status'], 'tools/workspace/status.js', 'Show workspace status.'),
  entry('workspace.build', ['workspace', 'build'], 'tools/workspace/build.js', 'Build workspace indexes.'),
  entry('workspace.catalog', ['workspace', 'catalog'], 'tools/workspace/catalog.js', 'Inspect workspace catalog.'),
  entry('service.api', ['service', 'api'], 'tools/api/server.js', 'Run local API service.'),
  entry('service.indexer', ['service', 'indexer'], 'tools/service/indexer-service.js', 'Run indexer service.'),
  entry('ingest.ctags', ['ingest', 'ctags'], 'tools/ingest/ctags.js', 'Ingest ctags symbols.', {
    expectedArtifacts: ['ingest:ctags']
  }),
  entry('ingest.gtags', ['ingest', 'gtags'], 'tools/ingest/gtags.js', 'Ingest GTAGS symbols.', {
    expectedArtifacts: ['ingest:gtags']
  }),
  entry('ingest.lsif', ['ingest', 'lsif'], 'tools/ingest/lsif.js', 'Ingest LSIF dump.', {
    expectedArtifacts: ['ingest:lsif']
  }),
  entry('ingest.scip', ['ingest', 'scip'], 'tools/ingest/scip.js', 'Ingest SCIP index.', {
    expectedArtifacts: ['ingest:scip']
  }),
  entry('tui.supervisor', ['tui', 'supervisor'], 'tools/tui/supervisor.js', 'Run Node supervisor process.')
]);

export const DISPATCH_BY_ID = Object.freeze(Object.fromEntries(DISPATCH_REGISTRY.map((item) => [item.id, item])));

export const commandPathKey = (parts) => parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ');

export const DISPATCH_BY_PATH = Object.freeze(
  Object.fromEntries(DISPATCH_REGISTRY.map((item) => [commandPathKey(item.commandPath), item]))
);
