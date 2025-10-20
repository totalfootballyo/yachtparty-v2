#!/bin/bash

# Setup Google Cloud Scheduler for Community Request Closure
# This creates a Cloud Scheduler job that calls the event-processor endpoint every hour

set -e

SERVICE_URL="https://event-processor-82471900833.us-central1.run.app"
JOB_NAME="close-expired-community-requests"
SCHEDULE="0 * * * *"  # Every hour at minute 0
REGION="us-central1"

echo "=========================================="
echo "Setting up Community Request Closure Scheduler"
echo "=========================================="

# Check if job already exists
if gcloud scheduler jobs describe "$JOB_NAME" --location="$REGION" &>/dev/null; then
  echo "Job $JOB_NAME already exists. Deleting..."
  gcloud scheduler jobs delete "$JOB_NAME" --location="$REGION" --quiet
fi

# Create the scheduler job
echo "Creating Cloud Scheduler job..."
gcloud scheduler jobs create http "$JOB_NAME" \
  --location="$REGION" \
  --schedule="$SCHEDULE" \
  --uri="$SERVICE_URL/close-expired-requests" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{}' \
  --time-zone="America/Los_Angeles" \
  --description="Automatically close expired community requests every hour"

echo ""
echo "✓ Cloud Scheduler job created successfully!"
echo ""
echo "Job details:"
gcloud scheduler jobs describe "$JOB_NAME" --location="$REGION"
echo ""
echo "To trigger manually:"
echo "  gcloud scheduler jobs run $JOB_NAME --location=$REGION"
echo ""
echo "To view logs:"
echo "  gcloud logging read \"resource.type=cloud_scheduler_job AND resource.labels.job_id=$JOB_NAME\" --limit=10"
echo ""
