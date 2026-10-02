#!/usr/bin/env node
import { RuleTester } from 'eslint';
import noRegexDoubleEscape from '../../eslint-rules/no-regex-double-escape.js';
import { ensureTestingEnv } from '../helpers/test-env.js';

ensureTestingEnv(process.env);
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
tester.run('no-regex-double-escape', noRegexDoubleEscape, {
  valid: [
    String.raw`const pattern = /\s+\d/giu;`,
    String.raw`const pattern = /[\\s]/;`,
    String.raw`const pattern = new RegExp('\\s+');`,
    'const value = "plain text";'
  ],
  invalid: [
    {
      code: String.raw`const pattern = /\\s+/g;`,
      output: String.raw`const pattern = /\s+/g;`,
      errors: [{ messageId: 'doubleEscape' }]
    },
    {
      code: String.raw`const pattern = /\\d+\\w/;`,
      output: String.raw`const pattern = /\d+\w/;`,
      errors: [{ messageId: 'doubleEscape' }]
    }
  ]
});
console.log('ESLint custom rule compatibility test passed');
