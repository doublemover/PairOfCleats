import { exec } from 'child_process';

export function runUnsafe(cmd) {
  return exec(cmd);
}
