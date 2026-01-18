# Test Times

## Setup Checklist
- [x] Write a little helper .ps1 (powershell 7) script that allows you to run a single test in your worktree without messing anything up
  - [x] This helper script will add a line to TEST_TIMES.md containing the path/filename of the test if it does not exist already, and then log how long it took to run that test
  - [x] Use this helper every time we have to run a test for this work, if a test takes longer than 10 seconds while you are doing this, cancel that specific test or end that specific process if you're absolutely sure you have to, and then add that test's path/filename to a SLOW_TESTS.md list

## Tracked Tests
<!-- TESTS:START -->
- `tests\git-blame-range.js`
<!-- TESTS:END -->

## Runs
<!-- RUNS:START -->
- 2026-01-18 07:01:28 | `tests\git-blame-range.js` | 8.79s | exit 0
<!-- RUNS:END -->
