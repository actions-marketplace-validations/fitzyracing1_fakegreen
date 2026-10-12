# Architecture

| Path | Role |
|---|---|
| `src/cli.ts` | argument parsing, commands (`scan`, `hook`, `install`, `rules`), output dispatch |
| `src/git.ts`, `src/diff.ts`, `src/linediff.ts` | obtain and parse unified diffs |
| `src/analyze.ts`, `src/context.ts`, `src/lang.ts`, `src/glob.ts` | run rules over parsed files with language context |
| `src/rules/*.ts` | rule implementations (`assertions`, `ci`, `patterns`, `source`, `suppressions`, `tests`) and `registry.ts` |
| `src/report/` | `pretty`, `machine` (json / sarif / github), `color` |
| `src/config.ts` | config file loading |
| `src/hook.ts`, `src/install.ts` | agent end-of-turn hook mode and installers |
| `src/index.ts` | library entry (`dist/index.js`) |
| `test/` | `node --test` suites and fixtures |

Flow: pick diff source → parse diff → analyze each changed file with every registered rule → filter by `--min-severity` → render → exit with a code based on `--fail-on`.
