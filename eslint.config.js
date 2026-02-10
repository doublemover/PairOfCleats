import noRegexDoubleEscape from './eslint-rules/no-regex-double-escape.js';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/index-*/**',
      '**/index-sqlite/**',
      'benchmarks/repos/**',
      'benchmarks/cache/**',
      'benchmarks/results/**',
      '.testCache/**',
      '.testLogs/**',
      'tests/.cache/**',
      '**/.worktrees/**',
      '**/worktrees/**',
      '**/.git/**',
      '**/docs/phase3-parity-report.json',
      'tests/fixtures/languages/src/javascript_flow.js',
      'tests/fixtures/encoding/latin1.js'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      local: {
        rules: {
          'no-regex-double-escape': noRegexDoubleEscape
        }
      }
    },
    rules: {
      'local/no-regex-double-escape': 'error',
      'max-lines': 'off',
      indent: ['error', 2, { SwitchCase: 1 }]
    }
  },
  {
    files: ['src/contracts/schemas/**/*.js'],
    rules: {
      'max-lines': 'off'
    }
  }
];
