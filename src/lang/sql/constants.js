/**
 * Map user-facing SQL dialect aliases to parser dialect ids.
 */
export const SQL_PARSER_DIALECTS = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite'
};

/**
 * Shared SQL keywords used for flow token filtering across dialects.
 */
export const SQL_RESERVED_WORDS_COMMON = new Set([
  'add',
  'all',
  'alter',
  'and',
  'any',
  'as',
  'asc',
  'begin',
  'between',
  'by',
  'case',
  'cast',
  'check',
  'column',
  'commit',
  'constraint',
  'create',
  'cross',
  'current',
  'cursor',
  'database',
  'declare',
  'default',
  'delete',
  'desc',
  'distinct',
  'drop',
  'else',
  'elseif',
  'elsif',
  'end',
  'escape',
  'except',
  'exists',
  'false',
  'fetch',
  'foreign',
  'for',
  'from',
  'full',
  'function',
  'grant',
  'group',
  'having',
  'if',
  'in',
  'index',
  'inner',
  'insert',
  'intersect',
  'into',
  'is',
  'join',
  'key',
  'left',
  'like',
  'limit',
  'loop',
  'materialized',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'order',
  'outer',
  'over',
  'partition',
  'primary',
  'procedure',
  'raise',
  'references',
  'repeat',
  'return',
  'returns',
  'revoke',
  'right',
  'rollback',
  'row',
  'rows',
  'schema',
  'select',
  'set',
  'signal',
  'table',
  'then',
  'transaction',
  'trigger',
  'true',
  'union',
  'unique',
  'until',
  'update',
  'values',
  'view',
  'when',
  'where',
  'while',
  'with'
]);

export const POSTGRES_RESERVED_WORDS = new Set([
  'analyse',
  'analyze',
  'array',
  'bigint',
  'bigserial',
  'bit',
  'boolean',
  'bytea',
  'cascade',
  'character',
  'collate',
  'comment',
  'concurrently',
  'current_catalog',
  'current_date',
  'current_schema',
  'current_time',
  'current_timestamp',
  'current_user',
  'cycle',
  'deallocate',
  'do',
  'explain',
  'extension',
  'generated',
  'identity',
  'ilike',
  'immutable',
  'inherits',
  'language',
  'listen',
  'local',
  'lock',
  'notify',
  'numeric',
  'owner',
  'prepare',
  'prepared',
  'reindex',
  'release',
  'rename',
  'restrict',
  'returning',
  'role',
  'savepoint',
  'security',
  'serial',
  'session_user',
  'setof',
  'share',
  'similar',
  'stable',
  'temp',
  'temporary',
  'timestamp',
  'unlogged',
  'uuid',
  'vacuum',
  'varying',
  'verbose',
  'volatile'
]);

export const MYSQL_RESERVED_WORDS = new Set([
  'after',
  'auto_increment',
  'before',
  'binary',
  'blob',
  'charset',
  'collate',
  'columns',
  'engine',
  'enum',
  'force',
  'fulltext',
  'generated',
  'high_priority',
  'ignore',
  'keys',
  'low_priority',
  'modify',
  'replace',
  'spatial',
  'sql_calc_found_rows',
  'sql_no_cache',
  'straight_join',
  'unsigned',
  'zerofill'
]);

export const SQLITE_RESERVED_WORDS = new Set([
  'abort',
  'action',
  'after',
  'attach',
  'autoincrement',
  'before',
  'cascade',
  'conflict',
  'deferred',
  'detach',
  'each',
  'exclusive',
  'fail',
  'glob',
  'immediate',
  'indexed',
  'initially',
  'instead',
  'isnull',
  'match',
  'notnull',
  'plan',
  'pragma',
  'query',
  'raise',
  'recursive',
  'release',
  'rename',
  'replace',
  'rowid',
  'temp',
  'temporary',
  'vacuum',
  'virtual',
  'without'
]);

export const SQL_RESERVED_WORDS = new Set([
  ...SQL_RESERVED_WORDS_COMMON,
  ...POSTGRES_RESERVED_WORDS,
  ...MYSQL_RESERVED_WORDS,
  ...SQLITE_RESERVED_WORDS
]);

/**
 * Build case-variant keyword skip list for heuristic SQL dataflow parsing.
 * @returns {Set<string>}
 */
function buildSqlFlowSkip() {
  const skip = new Set();
  for (const keyword of SQL_RESERVED_WORDS) {
    if (!keyword) continue;
    skip.add(keyword);
    skip.add(keyword.toUpperCase());
    skip.add(keyword[0].toUpperCase() + keyword.slice(1));
  }
  return skip;
}

export const SQL_FLOW_SKIP = buildSqlFlowSkip();

/**
 * SQL control-flow keyword families used by generic flow summarization.
 */
export const SQL_CONTROL_FLOW = {
  branchKeywords: ['case', 'when', 'then', 'else', 'if', 'elseif', 'elsif'],
  loopKeywords: ['loop', 'while', 'repeat', 'until', 'for', 'foreach'],
  returnKeywords: ['return'],
  breakKeywords: ['break', 'leave', 'exit'],
  continueKeywords: ['continue'],
  throwKeywords: ['raise', 'signal']
};

/**
 * SQL doc-comment extraction options (`--` and `/* ... *\/`).
 */
export const SQL_DOC_OPTIONS = {
  linePrefixes: ['--'],
  blockStarts: ['/*'],
  blockEnd: '*/'
};
