#!/bin/bash

# Specialized deployment for task-processor using Docker build/push
# This bypasses Cloud Build's automatic npm install which breaks our pre-built packages

set -e

SERVICE_NAME="task-processor"
REGION="us-central1"
PROJECT_ID="yachtparty-474117"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🚀 Deploying task-processor via Docker..."
echo ""

# Run standard prep (builds packages, creates deploy directory)
echo "Step 1: Preparing deployment directory..."
./deploy-service.sh ${SERVICE_NAME} 2>&1 | grep -E "(Step |Building |Copying |✅|❌)" || true

# Check if deployment directory was created
if [ ! -d ".deploy-temp-${SERVICE_NAME}" ]; then
  echo "❌ Deployment directory not created. Running full prep..."
  ./deploy-service.sh ${SERVICE_NAME}
fi

cd ".deploy-temp-${SERVICE_NAME}"

echo ""
echo "Step 2: Building Docker image locally..."
docker build --platform linux/amd64 -t ${IMAGE_NAME}:latest .

echo ""
echo "Step 3: Pushing to Google Container Registry..."
docker push ${IMAGE_NAME}:latest

echo ""
echo "Step 4: Deploying to Cloud Run from image..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --region ${REGION} \
  --allow-unauthenticated \
  --min-instances 1 \
  --memory 512Mi \
  --timeout 300 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"

cd ..

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Verifying deployment..."
./scripts/verify-deployment.sh ${SERVICE_NAME} ${REGION}
