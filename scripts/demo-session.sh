#!/usr/bin/env bash
# Driven by asciinema to record docs/demo.cast. Commands are "typed" for readability,
# but every line of output is produced live by git and fakegreen.
cd "${1:-/tmp/fakegreen-demo}"
export FORCE_COLOR=1 TERM=xterm-256color
unset NO_COLOR
type_cmd() {
  printf '\033[1;32m❯\033[0m '
  local s="$1"
  for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.03; done
  sleep 0.4; printf '\n'
  eval "$1"; local rc=$?
  sleep 1.2
  return $rc
}
sleep 0.5
type_cmd 'git log --oneline -2'
type_cmd 'git show --stat --format="%s" HEAD | cat'
type_cmd "fakegreen --last-commit"; code=$?
printf "\033[2m(exit code %s)\033[0m\n" "$code"
sleep 3
