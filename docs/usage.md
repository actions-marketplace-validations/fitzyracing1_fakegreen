# Usage

From the CLI help in `src/cli.ts`:

```
fakegreen [options]                 scan uncommitted + staged changes vs HEAD (+ untracked files)
fakegreen hook --agent <name>       end-of-turn hook mode (reads hook JSON on stdin)
fakegreen install <target>          claude | codex | gemini | pre-commit | github-action | skill
fakegreen rules                     list all rules
```

## Diff source (pick one)

| Flag | Meaning |
|---|---|
| `--staged` | only staged changes |
| `--base <ref>` | everything since the merge-base with `<ref>`, incl. uncommitted |
| `--last-commit` | `HEAD~1..HEAD` |
| `--commit <sha>` | a specific commit |
| `--diff <file\|->` | read a unified diff from a file or stdin |
| `--no-untracked` | ignore untracked files |

## Output and thresholds

| Flag | Meaning |
|---|---|
| `--json`, `--sarif`, `--format pretty\|json\|sarif\|github` | output format (default pretty) |
| `--fail-on high\|medium\|low\|none` | exit 1 when a finding is at/above this (default `high`) |
| `--min-severity <sev>` | hide findings below this (default `low`) |
| `--no-color` / `--color` | force colors; `NO_COLOR` and `FORCE_COLOR` are respected |
| `-C, --cwd <dir>` | run as if started in `<dir>` |
| `--config <file>` | default lookup: `.fakegreenrc.json`, `.fakegreenrc`, `package.json#fakegreen` |

Install flags: `--yes/-y`, `--dry-run`, `--global`, `--local` (Claude only), `--command <cmd>` (default `npx --yes fakegreen`), `--hook-args <args>`.

Exit codes: `0` clean, `1` findings at/above `--fail-on`, `2` usage or git error.

## Rules

Rule ids from `src/rules/registry.ts`: `assertion-expected-changed`, `assertion-removed`, `assertion-trivial`, `assertion-weakened`, `ci-failure-ignored`, `ci-step-disabled`, `ci-step-removed`, `coverage-exclusion-added`, `coverage-threshold-lowered`, `error-swallowed`, `ignore-comment-added`, `lint-rule-disabled`, `suppression-added`, `test-conditional-skip`, `test-count-dropped`, `test-env-special-case`, `test-exclusion-added`, `test-file-deleted`, `test-focused`, `test-script-neutered`, `test-skipped`, `typecheck-weakened`. Run `fakegreen rules` for descriptions and severities.

## GitHub Action

`action.yml` inputs: `version` (default `latest`), `base` (default `origin/<PR base>` or `HEAD~1`), `fail-on` (default `high`), `args`. See `examples/github-workflow.yml`.
