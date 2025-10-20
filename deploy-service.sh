#!/bin/bash

# ==============================================================================
# Yachtparty Service Deployment Script
# ==============================================================================
#
# This script deploys Cloud Run services from a monorepo with local dependencies.
#
# Problem: Cloud Run can't resolve file: dependencies like:
#   "@yachtparty/agent-bouncer": "file:../../agents/bouncer"
#
# Solution: Pre-build all packages and copy into deployment directory
#
# Usage:
#   ./deploy-service.sh twilio-webhook
#   ./deploy-service.sh task-processor
#   ./deploy-service.sh event-processor
#
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVICE_NAME="$1"
DEPLOY_DIR=".deploy-temp-${SERVICE_NAME}"
REGION="us-central1"

# Package paths
PACKAGES_DIR="packages"
AGENTS_DIR="${PACKAGES_DIR}/agents"
SERVICES_DIR="${PACKAGES_DIR}/services"
SHARED_DIR="${PACKAGES_DIR}/shared"

# Service-specific configuration
case "$SERVICE_NAME" in
  "twilio-webhook")
    SERVICE_PATH="${SERVICES_DIR}/twilio-webhook"
    MIN_INSTANCES=1
    MEMORY="512Mi"
    TIMEOUT=300
    SECRETS="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"
    ENV_VARS=""
    ;;
  "task-processor")
    SERVICE_PATH="${SERVICES_DIR}/task-processor"
    MIN_INSTANCES=1
    MEMORY="512Mi"
    TIMEOUT=300
    SECRETS="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"
    ENV_VARS=""
    ;;
  "event-processor")
    SERVICE_PATH="${SERVICES_DIR}/event-processor"
    MIN_INSTANCES=1
    MEMORY="512Mi"
    TIMEOUT=300
    SECRETS="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest"
    ENV_VARS=""
    ;;
  "message-orchestrator")
    SERVICE_PATH="${PACKAGES_DIR}/orchestrator"
    MIN_INSTANCES=1
    MEMORY="512Mi"
    TIMEOUT=300
    SECRETS="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"
    ENV_VARS="TWILIO_PHONE_NUMBER=+18445943348"
    ;;
  "realtime-processor")
    SERVICE_PATH="${SERVICES_DIR}/realtime-processor"
    MIN_INSTANCES=1
    MEMORY="512Mi"
    TIMEOUT=300
    SECRETS="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"
    ENV_VARS=""
    ;;
  *)
    echo -e "${RED}Error: Unknown service '${SERVICE_NAME}'${NC}"
    echo "Usage: $0 [twilio-webhook|task-processor|event-processor|message-orchestrator|realtime-processor]"
    exit 1
    ;;
esac

# Validate service exists
if [ ! -d "$SERVICE_PATH" ]; then
  echo -e "${RED}Error: Service directory not found: ${SERVICE_PATH}${NC}"
  exit 1
fi

echo -e "${BLUE}==============================================================================}${NC}"
echo -e "${BLUE}Deploying ${SERVICE_NAME} to Cloud Run${NC}"
echo -e "${BLUE}==============================================================================}${NC}"
echo ""

# ==============================================================================
# Pre-deployment Validation
# ==============================================================================

echo -e "${YELLOW}Running pre-deployment checks...${NC}"

# Check module system consistency
if [ -f "scripts/check-module-consistency.sh" ]; then
  ./scripts/check-module-consistency.sh
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Module consistency check failed. Fix errors before deploying.${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠️  Module consistency check script not found, skipping...${NC}"
fi

echo -e "${GREEN}✅ Pre-deployment checks passed${NC}"
echo ""

# ==============================================================================
# Step 1: Build all local packages
# ==============================================================================

echo -e "${YELLOW}Step 1: Building local packages...${NC}"
echo ""

# Build shared package (dependency of all agents)
echo -e "${GREEN}Building @yachtparty/shared...${NC}"
cd "${SHARED_DIR}"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
cd - > /dev/null

# Build agent packages
for AGENT in bouncer concierge account-manager innovator; do
  AGENT_PATH="${AGENTS_DIR}/${AGENT}"
  if [ -d "$AGENT_PATH" ]; then
    echo -e "${GREEN}Building @yachtparty/agent-${AGENT}...${NC}"
    cd "${AGENT_PATH}"
    if [ ! -d "node_modules" ]; then
      npm install
    fi
    npm run build
    cd - > /dev/null
  fi
done

echo -e "${GREEN}✅ All packages built successfully${NC}"
echo ""

# ==============================================================================
# Step 2: Create deployment directory
# ==============================================================================

echo -e "${YELLOW}Step 2: Creating deployment directory...${NC}"
echo ""

# Clean up old deployment directory
if [ -d "$DEPLOY_DIR" ]; then
  echo "Removing old deployment directory..."
  rm -rf "$DEPLOY_DIR"
fi

# Create fresh deployment directory
mkdir -p "$DEPLOY_DIR"

# Copy service files (excluding node_modules - we'll handle that separately)
echo "Copying service files..."
rsync -a --exclude='node_modules' --exclude='.gitignore' --exclude='.dockerignore' --exclude='.gcloudignore' "${SERVICE_PATH}/" "$DEPLOY_DIR/"

# Create a simple Dockerfile for deployment
echo "Creating deployment Dockerfile..."
cat > "${DEPLOY_DIR}/Dockerfile" <<'EOF'
FROM node:20-slim

WORKDIR /app

# Copy everything (dist, node_modules, package.json all pre-built)
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start the service
CMD ["npm", "start"]
EOF

# Create .dockerignore that does NOT exclude node_modules
cat > "${DEPLOY_DIR}/.dockerignore" <<'DOCKERIGNORE_EOF'
.env
.env.*
!.env.example
*.log
.git
.gitignore
.DS_Store
DOCKERIGNORE_EOF

echo -e "${GREEN}✅ Deployment directory created${NC}"
echo ""

# ==============================================================================
# Step 3: Copy built dependencies
# ==============================================================================

echo -e "${YELLOW}Step 3: Installing dependencies with built packages...${NC}"
echo ""

# Create node_modules/@yachtparty directory
mkdir -p "${DEPLOY_DIR}/node_modules/@yachtparty"

# Copy shared package (entire package for proper resolution)
echo "Copying @yachtparty/shared..."
mkdir -p "${DEPLOY_DIR}/node_modules/@yachtparty/shared"
cp -r "${SHARED_DIR}"/* "${DEPLOY_DIR}/node_modules/@yachtparty/shared/"

# Copy agent packages (entire packages)
for AGENT in bouncer concierge account-manager innovator; do
  AGENT_PATH="${AGENTS_DIR}/${AGENT}"
  if [ -d "$AGENT_PATH" ]; then
    echo "Copying @yachtparty/agent-${AGENT}..."
    mkdir -p "${DEPLOY_DIR}/node_modules/@yachtparty/agent-${AGENT}"
    cp -r "${AGENT_PATH}"/* "${DEPLOY_DIR}/node_modules/@yachtparty/agent-${AGENT}/"
  fi
done

# Copy service's existing node_modules (for non-local dependencies)
echo "Copying service node_modules..."
if [ -d "${SERVICE_PATH}/node_modules" ]; then
  # Copy all node_modules except @yachtparty (we already copied those)
  rsync -a --exclude='@yachtparty' "${SERVICE_PATH}/node_modules/" "${DEPLOY_DIR}/node_modules/"
fi

# Copy ALL dependencies from root node_modules (for workspace hoisting)
echo "Copying all hoisted dependencies from root..."
if [ -d "node_modules" ]; then
  echo "  Copying all root node_modules (this may take a moment)..."
  # Copy everything from root node_modules except @yachtparty (already copied)
  rsync -a --exclude='@yachtparty' node_modules/ "${DEPLOY_DIR}/node_modules/"
fi

echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# ==============================================================================
# Step 4: Deploy to Cloud Run
# ==============================================================================

echo -e "${YELLOW}Step 4: Deploying to Cloud Run...${NC}"
echo ""

cd "$DEPLOY_DIR"

# Check if service exists (for env var handling)
if gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" >/dev/null 2>&1; then
  echo "Updating existing service..."
  gcloud run deploy "${SERVICE_NAME}" \
    --source . \
    --region "${REGION}" \
    --allow-unauthenticated \
    --min-instances "${MIN_INSTANCES}" \
    --memory "${MEMORY}" \
    --timeout "${TIMEOUT}"
else
  echo "Creating new service with secrets..."
  # Build command with only non-empty params
  DEPLOY_CMD="gcloud run deploy \"${SERVICE_NAME}\" \
    --source . \
    --region \"${REGION}\" \
    --allow-unauthenticated \
    --min-instances \"${MIN_INSTANCES}\" \
    --memory \"${MEMORY}\" \
    --timeout \"${TIMEOUT}\""

  if [ -n "${SECRETS}" ]; then
    DEPLOY_CMD="${DEPLOY_CMD} --set-secrets \"${SECRETS}\""
  fi

  if [ -n "${ENV_VARS}" ]; then
    DEPLOY_CMD="${DEPLOY_CMD} --set-env-vars \"${ENV_VARS}\""
  fi

  eval "${DEPLOY_CMD}"
fi

DEPLOY_EXIT_CODE=$?

cd - > /dev/null

if [ $DEPLOY_EXIT_CODE -eq 0 ]; then
  echo ""
  echo -e "${GREEN}==============================================================================}${NC}"
  echo -e "${GREEN}✅ ${SERVICE_NAME} deployed successfully!${NC}"
  echo -e "${GREEN}==============================================================================}${NC}"
  echo ""

  # Get service URL
  SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")
  echo -e "${BLUE}Service URL: ${SERVICE_URL}${NC}"

  # Run post-deployment verification
  echo ""
  if [ -f "scripts/verify-deployment.sh" ]; then
    ./scripts/verify-deployment.sh "${SERVICE_NAME}" "${REGION}"
  else
    echo -e "${YELLOW}⚠️  Deployment verification script not found, skipping health checks${NC}"
  fi

  # Clean up deployment directory
  echo ""
  echo "Cleaning up deployment directory..."
  rm -rf "$DEPLOY_DIR"

  echo -e "${GREEN}✅ Cleanup complete${NC}"
else
  echo ""
  echo -e "${RED}==============================================================================}${NC}"
  echo -e "${RED}❌ Deployment failed${NC}"
  echo -e "${RED}==============================================================================}${NC}"
  echo ""
  echo "Deployment directory preserved at: ${DEPLOY_DIR}"
  echo "Check logs for details"
  exit 1
fi
