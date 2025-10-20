#!/bin/bash
################################################################################
# Google Cloud Secret Manager Setup Script
#
# Creates all required secrets for Yachtparty deployment
#
# Usage:
#   ./scripts/setup-secrets.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Project configured (gcloud config set project YOUR_PROJECT_ID)
#   - Secret Manager API enabled
################################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Get GCP project
GCP_PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [[ -z "$GCP_PROJECT_ID" ]]; then
    log_error "GCP project not set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

log_info "Setting up secrets for project: $GCP_PROJECT_ID"

# Enable Secret Manager API
log_info "Enabling Secret Manager API..."
gcloud services enable secretmanager.googleapis.com --project="$GCP_PROJECT_ID" --quiet

# Function to create or update a secret
create_or_update_secret() {
    local secret_name=$1
    local secret_value=$2

    if [[ -z "$secret_value" ]]; then
        log_warning "Skipping $secret_name (value not provided)"
        return 0
    fi

    log_info "Setting up secret: $secret_name"

    # Check if secret exists
    if gcloud secrets describe "$secret_name" --project="$GCP_PROJECT_ID" &>/dev/null; then
        # Secret exists, add new version
        echo -n "$secret_value" | gcloud secrets versions add "$secret_name" \
            --project="$GCP_PROJECT_ID" \
            --data-file=- \
            --quiet
        log_success "Updated $secret_name"
    else
        # Create new secret
        echo -n "$secret_value" | gcloud secrets create "$secret_name" \
            --project="$GCP_PROJECT_ID" \
            --replication-policy="automatic" \
            --data-file=- \
            --quiet
        log_success "Created $secret_name"
    fi
}

# Prompt for secrets
log_info "=========================================="
log_info "Please provide the following values:"
log_info "=========================================="

echo ""
read -p "Supabase URL (https://wdjmhpmwiunkltkodbqh.supabase.co): " SUPABASE_URL
SUPABASE_URL=${SUPABASE_URL:-https://wdjmhpmwiunkltkodbqh.supabase.co}

echo ""
read -sp "Supabase Service Key: " SUPABASE_SERVICE_KEY
echo ""

echo ""
read -p "Twilio Account SID: " TWILIO_ACCOUNT_SID

echo ""
read -sp "Twilio Auth Token: " TWILIO_AUTH_TOKEN
echo ""

echo ""
read -p "Twilio Phone Number (E.164 format, e.g., +15551234567): " TWILIO_PHONE_NUMBER

echo ""
read -sp "Anthropic API Key: " ANTHROPIC_API_KEY
echo ""

echo ""
read -p "Database URL: " DATABASE_URL

# Create/update secrets
log_info ""
log_info "Creating secrets in Google Secret Manager..."
log_info ""

create_or_update_secret "SUPABASE_URL" "$SUPABASE_URL"
create_or_update_secret "SUPABASE_SERVICE_KEY" "$SUPABASE_SERVICE_KEY"
create_or_update_secret "TWILIO_ACCOUNT_SID" "$TWILIO_ACCOUNT_SID"
create_or_update_secret "TWILIO_AUTH_TOKEN" "$TWILIO_AUTH_TOKEN"
create_or_update_secret "TWILIO_PHONE_NUMBER" "$TWILIO_PHONE_NUMBER"
create_or_update_secret "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
create_or_update_secret "DATABASE_URL" "$DATABASE_URL"

log_info ""
log_success "=========================================="
log_success "All secrets configured successfully!"
log_success "=========================================="
log_info ""
log_info "You can now run the deployment script:"
log_info "  ./scripts/deploy.sh --skip-tests --skip-migrations"
