# Contributing to fakegreen

Thanks for helping catch fake green builds! The project's promise is **deterministic, fast, zero runtime
dependencies, low noise**. Every change should keep those four properties.

## Setup

```sh
git clone https://github.com/fitzyracing1/fakegreen && cd fakegreen
npm install
npm test            # builds, compiles the tests, runs node --test
node dist/cli.js --help
```

Node 18+ and git are required. There are no runtime dependencies. Please don't add any. Dev dependencies are
TypeScript and `@types/node` only.

## Layout

| Path | What lives there |
|---|---|
| `src/diff.ts` | Unified-diff parser (renames, quoted paths, binary files, line numbers) |
| `src/git.ts` | Which diff to scan (`worktree`, `--staged`, `--base`, `--last-commit`, `--commit`) |
| `src/lang.ts` | Language / file-kind detection, test-path detection, string+comment lexer |
| `src/context.ts` | Per-file analysis context (lexed lines, moved-line detection) |
| `src/rules/*.ts` | Detectors, grouped by family; `registry.ts` lists every rule id and default severity |
| `src/analyze.ts` | Runs rules, applies config and inline `fakegreen-ignore`, dedupes and sorts |
| `src/report/*` | Pretty, JSON, SARIF and GitHub-annotation output |
| `src/hook.ts`, `src/install.ts` | Agent hook protocol and installers |
| `test/` | `node:test` suites; `test/helpers.ts` has `scanEdit()` and temp-repo helpers |
| `scripts/dogfood.js` | Noise check against real repositories (dev only) |

## Adding or changing a detector

1. Register the rule id, default severity and one-line description in `src/rules/registry.ts`.
2. Implement it in the right `src/rules/*.ts` file. Match only on **added/removed lines**, use the lexed `code`
   (strings and comments blanked) unless you specifically need comments, and skip lines that were only moved.
3. Add tests in the matching `test/rules-*.test.ts`:
   - at least one **true positive** per language you support;
   - at least one **false-positive guard** (the pattern inside a string or comment, a rename or move, an idiomatic
     rewrite, a non-test file).
4. Run the dogfood script on a few real repos and include the before/after numbers in your PR:

   ```sh
   mkdir -p /tmp/repos && cd /tmp/repos
   git clone --filter=blob:none https://github.com/pallets/flask
   git clone --filter=blob:none https://github.com/colinhacks/zod
   cd - && npm run build && node scripts/dogfood.js /tmp/repos 100 --details
   ```

   A new **high** finding on human-written commits must be something a reviewer would genuinely want to see.

## Severity guidelines

- **high**: almost always means the build is green for the wrong reason (skip added, test deleted, `|| true` on the
  test step, assertion weakened, test-env branch in production code). These block by default.
- **medium**: often legitimate but worth a look (blanket suppression, swallowed error, assertions removed).
- **low**: context for reviewers (targeted suppressions, conditional skips, expected values changed, waivers).

## Pull requests

- Keep PRs focused; one detector or fix per PR is ideal.
- `npm test` must pass on Node 18, 20 and 22 (CI runs all three).
- Update the rules table in `README.md` if you add or rename a rule (`node dist/cli.js rules` prints the list).
- By contributing you agree that your contributions are licensed under the MIT License.
