#!/bin/bash
# Run frontend tests in batches to avoid OOM worker crashes
# Usage: bash scripts/test-batch.sh
set -e

cd "$(dirname "$0")/.."
export NODE_OPTIONS="--max-old-space-size=2048"

BATCH_SIZE=15
FILES=($(find src/__tests__ -name "*.test.*" | sort))
TOTAL=${#FILES[@]}
PASSED=0
FAILED=0
FAILED_FILES=()

echo "Running $TOTAL test files in batches of $BATCH_SIZE..."
echo ""

for ((i=0; i<TOTAL; i+=BATCH_SIZE)); do
    BATCH=("${FILES[@]:$i:$BATCH_SIZE}")
    BATCH_NUM=$((i/BATCH_SIZE + 1))
    BATCH_COUNT=${#BATCH[@]}
    echo "═══ Batch $BATCH_NUM ($BATCH_COUNT files) ═══"
    
    if npx vitest run "${BATCH[@]}" --reporter=dot 2>&1 | tail -3; then
        PASSED=$((PASSED + BATCH_COUNT))
        echo "  ✅ Batch $BATCH_NUM passed"
    else
        FAILED=$((FAILED + BATCH_COUNT))
        FAILED_FILES+=("${BATCH[@]}")
        echo "  ❌ Batch $BATCH_NUM had failures"
    fi
    echo ""
done

echo "══════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed out of $TOTAL files"

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
    echo ""
    echo "Failed files:"
    for f in "${FAILED_FILES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi

echo "All tests passed! ✅"
