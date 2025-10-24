#!/bin/bash

# Run all agent tests and save outputs to individual files for review
# This makes it easy to inspect all LLM responses

export ANTHROPIC_API_KEY="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"

echo "Running all agent tests and saving outputs..."
echo ""

# Create output directory
mkdir -p test-outputs

# Bouncer tests
echo "Running Bouncer tests..."
cd packages/agents/bouncer
npm test > ../../../test-outputs/bouncer-output.log 2>&1
echo "✓ Bouncer output saved to test-outputs/bouncer-output.log"

# Concierge tests
echo "Running Concierge tests..."
cd ../concierge
npm test > ../../../test-outputs/concierge-output.log 2>&1
echo "✓ Concierge output saved to test-outputs/concierge-output.log"

# Innovator tests (only working ones)
echo "Running Innovator shared tests..."
cd ../innovator
npm test -- innovator.shared-concierge-behavior.test.ts > ../../../test-outputs/innovator-shared-output.log 2>&1
echo "✓ Innovator output saved to test-outputs/innovator-shared-output.log"

cd ../../..
echo ""
echo "All test outputs saved to test-outputs/ directory"
echo ""
echo "To review:"
echo "  cat test-outputs/bouncer-output.log"
echo "  cat test-outputs/concierge-output.log"
echo "  cat test-outputs/innovator-shared-output.log"
echo ""
echo "To search for specific patterns:"
echo "  grep -i 'agent response' test-outputs/*.log"
echo "  grep -i 'route' test-outputs/*.log"
echo "  grep -i 'innovators' test-outputs/*.log"
