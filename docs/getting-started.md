# Getting started

## Run without installing

```sh
npx fakegreen
```

This scans uncommitted and staged changes against `HEAD`, including untracked files.

## Install as a dev dependency

```sh
npm i -D fakegreen
npx fakegreen --help
```

## Build from source

```sh
git clone https://github.com/fitzyracing1/fakegreen && cd fakegreen
npm install
npm test            # builds dist/, compiles tests, runs node --test
node dist/cli.js --help
```

Example configs live in `examples/` (`fakegreenrc.json`, `github-workflow.yml`, `claude-settings.json`).
