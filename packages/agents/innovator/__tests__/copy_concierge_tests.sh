#!/bin/bash

for file in scenarios multi-message reengagement edgecases; do
  source="../../concierge/__tests__/concierge.${file}.test.ts"
  target="innovator.inherited-${file}.test.ts"
  
  sed -e "s/invokeConciergeAgent/invokeInnovatorAgent/g" \
      -e "s|from '../src/index'|from '../src/index'|g" \
      -e "s|from './fixtures'|from '../../concierge/__tests__/fixtures'|g" \
      -e "s|from './helpers'|from '../../concierge/__tests__/helpers'|g" \
      -e "s|from './mocks/supabase.mock'|from '../../concierge/__tests__/mocks/supabase.mock'|g" \
      -e "s/Concierge Agent/Innovator Agent - Inherited from Concierge/g" \
      -e "s/describe('Concierge/describe('Innovator/g" \
      -e "s/=== Concierge/=== Innovator/g" \
      "$source" > "$target"
  
  echo "Created: $target"
done
