#!/bin/bash

# Email Verification Endpoint Test Script
# Usage: ./test-verify-email.sh [user_id] [cloud_run_url]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
USER_ID="${1}"
CLOUD_RUN_URL="${2}"

if [ -z "$USER_ID" ] || [ -z "$CLOUD_RUN_URL" ]; then
  echo -e "${RED}Usage: ./test-verify-email.sh <user_id> <cloud_run_url>${NC}"
  echo ""
  echo "Example:"
  echo "  ./test-verify-email.sh a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6 https://twilio-webhook-abc123.run.app"
  echo ""
  echo "To get a user_id:"
  echo "  1. Log into Supabase dashboard"
  echo "  2. Go to Table Editor > users"
  echo "  3. Copy any user's id (UUID)"
  exit 1
fi

# Remove trailing slash from URL
CLOUD_RUN_URL="${CLOUD_RUN_URL%/}"

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Email Verification Endpoint Test${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "${YELLOW}User ID:${NC} $USER_ID"
echo -e "${YELLOW}Endpoint:${NC} $CLOUD_RUN_URL/verify-email"
echo ""

# Test 1: Valid verification email
echo -e "${BLUE}Test 1: Valid Verification Email${NC}"
echo "Testing with properly formatted email..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CLOUD_RUN_URL/verify-email" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"verify-$USER_ID@verify.yachtparty.xyz\",
    \"from\": \"test@example.com\",
    \"subject\": \"Test Verification Email\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "${YELLOW}HTTP Status:${NC} $HTTP_CODE"
echo -e "${YELLOW}Response:${NC}"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ Test 1 PASSED${NC}"
else
  echo -e "${RED}✗ Test 1 FAILED${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

# Test 2: Invalid email format (no user_id)
echo -e "${BLUE}Test 2: Invalid Email Format${NC}"
echo "Testing with incorrect email format (should fail)..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CLOUD_RUN_URL/verify-email" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"hello@verify.yachtparty.xyz\",
    \"from\": \"test@example.com\",
    \"subject\": \"Test\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "${YELLOW}HTTP Status:${NC} $HTTP_CODE"
echo -e "${YELLOW}Response:${NC}"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✓ Test 2 PASSED (correctly rejected invalid format)${NC}"
else
  echo -e "${RED}✗ Test 2 FAILED (should return 400 Bad Request)${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

# Test 3: Missing recipient field
echo -e "${BLUE}Test 3: Missing Recipient${NC}"
echo "Testing with missing 'to' field (should fail)..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CLOUD_RUN_URL/verify-email" \
  -H "Content-Type: application/json" \
  -d "{
    \"from\": \"test@example.com\",
    \"subject\": \"Test\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "${YELLOW}HTTP Status:${NC} $HTTP_CODE"
echo -e "${YELLOW}Response:${NC}"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✓ Test 3 PASSED (correctly rejected missing recipient)${NC}"
else
  echo -e "${RED}✗ Test 3 FAILED (should return 400 Bad Request)${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

# Test 4: Non-existent user
echo -e "${BLUE}Test 4: Non-Existent User${NC}"
echo "Testing with fake user UUID (should fail)..."
echo ""

FAKE_UUID="00000000-0000-0000-0000-000000000000"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CLOUD_RUN_URL/verify-email" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"verify-$FAKE_UUID@verify.yachtparty.xyz\",
    \"from\": \"test@example.com\",
    \"subject\": \"Test\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "${YELLOW}HTTP Status:${NC} $HTTP_CODE"
echo -e "${YELLOW}Response:${NC}"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "404" ]; then
  echo -e "${GREEN}✓ Test 4 PASSED (correctly rejected non-existent user)${NC}"
else
  echo -e "${RED}✗ Test 4 FAILED (should return 404 Not Found)${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

# Test 5: Alternative email formats (envelope format)
echo -e "${BLUE}Test 5: Alternative Email Format (Envelope)${NC}"
echo "Testing with envelope-style payload..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CLOUD_RUN_URL/verify-email" \
  -H "Content-Type: application/json" \
  -d "{
    \"envelope\": {
      \"to\": \"verify-$USER_ID@verify.yachtparty.xyz\",
      \"from\": \"test@example.com\"
    },
    \"subject\": \"Test Envelope Format\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "${YELLOW}HTTP Status:${NC} $HTTP_CODE"
echo -e "${YELLOW}Response:${NC}"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ Test 5 PASSED (supports envelope format)${NC}"
else
  echo -e "${RED}✗ Test 5 FAILED${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

# Summary
echo -e "${BLUE}Test Summary${NC}"
echo ""
echo "All tests completed. Review results above."
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Check Supabase dashboard to verify user record was updated"
echo "2. Check messages table for confirmation SMS"
echo "3. Check agent_actions_log for verification event"
echo ""
echo "Query user record:"
echo "  SELECT id, first_name, verified, poc_agent_type, updated_at"
echo "  FROM users WHERE id = '$USER_ID';"
echo ""
echo "Query verification log:"
echo "  SELECT * FROM agent_actions_log"
echo "  WHERE action_type = 'email_verification_completed'"
echo "  AND user_id = '$USER_ID'"
echo "  ORDER BY created_at DESC LIMIT 1;"
echo ""
echo "Query confirmation SMS:"
echo "  SELECT role, content, direction, status, created_at"
echo "  FROM messages"
echo "  WHERE user_id = '$USER_ID'"
echo "  AND direction = 'outbound'"
echo "  ORDER BY created_at DESC LIMIT 1;"
echo ""
