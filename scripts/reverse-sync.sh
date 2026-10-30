#!/usr/bin/env bash
set -euo pipefail
# No URLs, passwords, tokens, secret files or production switches in argv.
# Native execution is ONLY a newly owned disposable Oracle staging rehearsal.
task_reverse_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:---dry-run}" in
  --dry-run)
    test "$#" -le 2
    exec python3 "$task_reverse_repo/infra/oracle/reverse_sync.py" --dry-run "${2:-reverse_20261030T000000Z_00000000}"
    ;;
  --rehearse)
    test "$#" -eq 2
    exec python3 "$task_reverse_repo/infra/oracle/reverse_sync.py" --rehearse "$2"
    ;;
  *) printf '%s\n' 'Refused: disposable staging rehearsal only; no production or Supabase cloud destination is implemented.' >&2; exit 1 ;;
esac
