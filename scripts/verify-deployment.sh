#!/bin/bash
# Verify Deployment Success
# Checks that a Cloud Run service is healthy after deployment

set -e

SERVICE_NAME="$1"
REGION="${2:-us-central1}"
MAX_WAIT=120  # Wait up to 2 minutes

if [ -z "$SERVICE_NAME" ]; then
  echo "Usage: $0 <service-name> [region]"
  exit 1
fi

echo "Verifying deployment of $SERVICE_NAME..."
echo ""

# Wait for service to be ready
echo "Waiting for service to become ready..."
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Check service status
  STATUS=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.conditions[0].status)" 2>/dev/null || echo "Unknown")

  if [ "$STATUS" = "True" ]; then
    echo "✅ Service is ready"
    break
  fi

  echo "  Status: $STATUS (${ELAPSED}s elapsed)"
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "❌ ERROR: Service did not become ready within ${MAX_WAIT}s"
  echo ""
  echo "Check logs:"
  echo "  gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=50"
  exit 1
fi

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.url)")

# Test health endpoint
echo ""
echo "Testing health endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/health" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Health check passed (HTTP $HTTP_CODE)"
else
  echo "❌ Health check failed (HTTP $HTTP_CODE)"
  echo ""
  echo "Service may not be properly configured. Check:"
  echo "  1. PORT environment variable set to 8080"
  echo "  2. Service listening on 0.0.0.0:8080"
  echo "  3. /health endpoint implemented"
  exit 1
fi

# Check recent logs for errors
echo ""
echo "Checking recent logs for errors..."
ERROR_COUNT=$(gcloud run services logs read "$SERVICE_NAME" --region="$REGION" --limit=20 --format="value(severity)" | grep -c "ERROR" || echo "0")

if [ "$ERROR_COUNT" -gt 0 ]; then
  echo "⚠️  Found $ERROR_COUNT errors in recent logs"
  echo ""
  echo "View logs:"
  echo "  gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=50"
else
  echo "✅ No errors in recent logs"
fi

echo ""
echo "✅ Deployment verification complete"
echo "   Service URL: $SERVICE_URL"
