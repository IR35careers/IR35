#!/usr/bin/env bash
set -euo pipefail
# No connection string or secret arguments. Default is non-mutating.
task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:---dry-run}" in
  --dry-run) test "$#" -le 1; exec python3 "$task_repo/infra/oracle/rehearsal.py" --dry-run ;;
  *) printf '%s\n' 'Refused: use the reviewed private credential wrapper for fixed staging cycles. No production destination or cutover flag is implemented.' >&2; exit 1 ;;
esac
