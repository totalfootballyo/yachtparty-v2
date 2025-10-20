#!/bin/bash
# Check Module System Consistency
# Ensures all packages use the same module system (CommonJS)

set -e

echo "Checking module system consistency..."
echo ""

ERRORS=0

# Check shared package
if grep -q '"type": "module"' packages/shared/package.json 2>/dev/null; then
  echo "❌ ERROR: packages/shared has type: module (should be CommonJS)"
  ERRORS=$((ERRORS + 1))
fi

if grep -q '"module": "ES' packages/shared/tsconfig.json 2>/dev/null; then
  echo "❌ ERROR: packages/shared has ES module in tsconfig (should be commonjs)"
  ERRORS=$((ERRORS + 1))
fi

# Check all services
for service_dir in packages/services/*/; do
  service_name=$(basename "$service_dir")

  if [ -f "$service_dir/package.json" ]; then
    if grep -q '"type": "module"' "$service_dir/package.json"; then
      echo "❌ ERROR: $service_name has type: module (should be CommonJS)"
      ERRORS=$((ERRORS + 1))
    fi
  fi

  if [ -f "$service_dir/tsconfig.json" ]; then
    if grep -q '"module": "ES' "$service_dir/tsconfig.json"; then
      echo "❌ ERROR: $service_name has ES module in tsconfig (should be commonjs)"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# Check all agents
for agent_dir in packages/agents/*/; do
  agent_name=$(basename "$agent_dir")

  if [ -f "$agent_dir/package.json" ]; then
    if grep -q '"type": "module"' "$agent_dir/package.json"; then
      echo "❌ ERROR: $agent_name has type: module (should be CommonJS)"
      ERRORS=$((ERRORS + 1))
    fi
  fi

  if [ -f "$agent_dir/tsconfig.json" ]; then
    if grep -q '"module": "ES' "$agent_dir/tsconfig.json"; then
      echo "❌ ERROR: $agent_name has ES module in tsconfig (should be commonjs)"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

if [ $ERRORS -eq 0 ]; then
  echo "✅ All packages are using CommonJS consistently"
  exit 0
else
  echo ""
  echo "❌ Found $ERRORS module system inconsistencies"
  echo ""
  echo "To fix:"
  echo "1. Remove '\"type\": \"module\"' from package.json files"
  echo "2. Change '\"module\": \"ES2022\"' to '\"module\": \"commonjs\"' in tsconfig.json files"
  exit 1
fi
