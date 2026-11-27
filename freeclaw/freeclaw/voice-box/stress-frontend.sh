#!/bin/bash
# Heavy stress run: repeat the full frontend suite N times and record every summary.
# On failure, dump the "Failed Tests" section into /tmp/stress-fails.log.
# Usage: bash stress-frontend.sh [count]   (default 10)
cd "$(dirname "$0")"
N="${1:-10}"
OUT=/tmp/stress-frontend.log
FAILS=/tmp/stress-fails.log
: > "$OUT"
: > "$FAILS"
for i in $(seq 1 "$N"); do
  # Route through the launcher so the transform cache stays inside the
  # workspace instead of a shared temp dir that can be swept mid-run.
  RUN_OUT=$(node ./scripts/vitest-run.mjs run --reporter=dot 2>&1)
  EXIT=$?
  {
    echo "=== RUN $i/$N $(date +%T) ==="
    echo "$RUN_OUT" | grep -E "Test Files|Tests "
    echo "EXIT: $EXIT"
  } >> "$OUT"
  if [ "$EXIT" -ne 0 ]; then
    {
      echo "=== FAILURE DETAIL RUN $i/$N $(date +%T) ==="
      echo "$RUN_OUT" | grep -A 40 "Failed Tests"
    } >> "$FAILS"
  fi
done
echo "STRESS_DONE" >> "$OUT"
