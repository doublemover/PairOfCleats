import fs from 'node:fs/promises';
import { createRetainedAnswerStore } from '../../../src/context-pack/answers/retention.js';
const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const store = createRetainedAnswerStore({ repoRoot: input.repoRoot, userConfig: input.userConfig });
const result = input.mode === 'begin' ? await store.begin(input.request)
  : input.mode === 'commit' ? await store.commit(input.intent, input.answer) : await store.read(input.questionRef);
process.stdout.write(JSON.stringify(result) + '\n');
