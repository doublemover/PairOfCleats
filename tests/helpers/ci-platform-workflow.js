import fs from 'node:fs';
import { parse } from 'yaml';

export const readPlatformWorkflow = () => parse(fs.readFileSync('.github/workflows/ci-platform.yml', 'utf8'));

/** Inspect actual composite steps selected on this OS; no workflow execution. */
export const platformToolingSteps = platform => {
  const os = { ubuntu: 'Linux', windows: 'Windows', macos: 'macOS' }[platform];
  if (!os) throw new Error('Unknown workflow platform.');
  const workflow = readPlatformWorkflow();
  const action = parse(fs.readFileSync('.github/actions/ci-tooling/action.yml', 'utf8'));
  return workflow.jobs.tooling.steps.flatMap(step => step.uses === './.github/actions/ci-tooling'
    ? action.runs.steps.filter(candidate => !candidate.if || candidate.if.split(' || ').includes(`runner.os == '${os}'`))
    : [step]);
};
