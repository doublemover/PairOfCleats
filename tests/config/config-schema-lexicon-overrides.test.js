#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateConfig } from '../../src/config/validate.js';
import { loadConfigSchema } from '../helpers/config-schema.js';

const schema = await loadConfigSchema();

const validConfig = {
  indexing: {
    lexicon: {
      enabled: true,
      relations: {
        enabled: true,
        stableDedupe: true,
        drop: {
          keywords: false,
          literals: true,
          builtins: false,
          types: false
        }
      },
      languageOverrides: {
        python: {
          relations: {
            enabled: true,
            stableDedupe: false,
            drop: {
              keywords: true,
              literals: false,
              builtins: false,
              types: false
            }
          }
        }
      }
    }
  }
};

const validResult = validateConfig(schema, validConfig);
assert.equal(validResult.ok, true, `expected lexicon override config to validate: ${validResult.errors?.join('; ')}`);

const invalidConfig = {
  indexing: {
    lexicon: {
      relations: {
        drop: {
          unknownKey: true
        }
      }
    }
  }
};

const invalidResult = validateConfig(schema, invalidConfig);
assert.equal(invalidResult.ok, false, 'expected unknown relation drop key to fail schema validation');

console.log('config schema lexicon overrides test passed');
