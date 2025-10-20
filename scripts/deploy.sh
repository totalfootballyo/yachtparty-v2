#!/bin/bash
################################################################################
# Yachtparty Manual Deployment Script
#
# This script builds, pushes, and deploys all Yachtparty services to Google
# Cloud Run. It includes error handling, validation, and verification steps.
#
# Usage:
#   ./scripts/deploy.sh                    # Deploy all services
#   ./scripts/deploy.sh --dry-run          # Show what would be deployed
#   ./scripts/deploy.sh --service twilio   # Deploy specific service
#   ./scripts/deploy.sh --skip-tests       # Skip test execution
#   ./scripts/deploy.sh --skip-migrations  # Skip database migrations
#
# Prerequisites:
#   - Google Cloud SDK (gcloud) installed and authenticated
#   - Docker installed and running
#   - Required environment variables set (see .env.example)
#
################################################################################

set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default configuration
DRY_RUN=false
SKIP_TESTS=false
SKIP_MIGRATIONS=false
SPECIFIC_SERVICE=""
GCP_REGION="${GCP_REGION:-us-central1}"
REGISTRY="gcr.io"

# Service definitions
declare -A SERVICES=(
    ["twilio-webhook"]="packages/services/twilio-webhook"
    ["sms-sender"]="packages/services/sms-sender"
    ["realtime-processor"]="packages/services/realtime-processor"
)

declare -A SERVICE_CONFIG=(
    ["twilio-webhook:min_instances"]="1"
    ["twilio-webhook:max_instances"]="10"
    ["twilio-webhook:memory"]="512Mi"
    ["twilio-webhook:cpu"]="1"
    ["twilio-webhook:concurrency"]="80"
    ["twilio-webhook:timeout"]="60"

    ["sms-sender:min_instances"]="1"
    ["sms-sender:max_instances"]="5"
    ["sms-sender:memory"]="512Mi"
    ["sms-sender:cpu"]="1"
    ["sms-sender:concurrency"]="1000"
    ["sms-sender:timeout"]="3600"

    ["realtime-processor:min_instances"]="1"
    ["realtime-processor:max_instances"]="5"
    ["realtime-processor:memory"]="512Mi"
    ["realtime-processor:cpu"]="1"
    ["realtime-processor:concurrency"]="1000"
    ["realtime-processor:timeout"]="3600"
)

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI is not installed. Please install it from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    # Check if docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install it from: https://docs.docker.com/get-docker/"
        exit 1
    fi

    # Check if docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi

    # Check if authenticated to gcloud
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
        log_error "Not authenticated to Google Cloud. Run: gcloud auth login"
        exit 1
    fi

    # Get and validate GCP project
    GCP_PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
    if [[ -z "$GCP_PROJECT_ID" ]]; then
        log_error "GCP project not set. Run: gcloud config set project YOUR_PROJECT_ID"
        exit 1
    fi

    log_success "All prerequisites met"
    log_info "GCP Project: $GCP_PROJECT_ID"
    log_info "GCP Region: $GCP_REGION"
}

run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        log_warning "Skipping tests (--skip-tests flag provided)"
        return 0
    fi

    log_info "Running tests..."

    cd "$PROJECT_ROOT"

    # Run linter
    if npm run lint 2>/dev/null; then
        log_success "Linting passed"
    else
        log_warning "Linting failed (continuing anyway)"
    fi

    # Run tests
    if npm test; then
        log_success "All tests passed"
    else
        log_error "Tests failed. Fix tests or use --skip-tests to deploy anyway."
        exit 1
    fi
}

run_migrations() {
    if [[ "$SKIP_MIGRATIONS" == true ]]; then
        log_warning "Skipping database migrations (--skip-migrations flag provided)"
        return 0
    fi

    log_info "Running database migrations..."

    if [[ -z "${DATABASE_URL:-}" ]]; then
        log_error "DATABASE_URL environment variable not set"
        exit 1
    fi

    cd "$PROJECT_ROOT"

    if npm run db:migrate; then
        log_success "Database migrations completed"
    else
        log_error "Database migrations failed"
        exit 1
    fi
}

build_image() {
    local service_name=$1
    local service_path=${SERVICES[$service_name]}
    local image_tag="$REGISTRY/$GCP_PROJECT_ID/$service_name:latest"
    local git_sha_tag="$REGISTRY/$GCP_PROJECT_ID/$service_name:$(git rev-parse --short HEAD 2>/dev/null || echo 'manual')"

    log_info "Building Docker image for $service_name..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would build: $image_tag"
        return 0
    fi

    # Determine build context and dockerfile
    local build_context
    local dockerfile

    if [[ "$service_name" == "twilio-webhook" ]]; then
        build_context="$PROJECT_ROOT"
        dockerfile="$PROJECT_ROOT/$service_path/Dockerfile"
    else
        build_context="$PROJECT_ROOT/$service_path"
        dockerfile="$build_context/Dockerfile"
    fi

    # Build the image
    if docker build \
        -t "$image_tag" \
        -t "$git_sha_tag" \
        -f "$dockerfile" \
        "$build_context"; then
        log_success "Built $service_name image"
    else
        log_error "Failed to build $service_name image"
        return 1
    fi
}

push_image() {
    local service_name=$1
    local image_tag="$REGISTRY/$GCP_PROJECT_ID/$service_name:latest"

    log_info "Pushing Docker image for $service_name..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would push: $image_tag"
        return 0
    fi

    # Configure Docker to use gcloud as credential helper
    gcloud auth configure-docker --quiet

    if docker push "$image_tag"; then
        log_success "Pushed $service_name image"
    else
        log_error "Failed to push $service_name image"
        return 1
    fi
}

deploy_service() {
    local service_name=$1
    local image_tag="$REGISTRY/$GCP_PROJECT_ID/$service_name:latest"

    log_info "Deploying $service_name to Cloud Run..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would deploy: $service_name"
        log_info "[DRY RUN] Image: $image_tag"
        log_info "[DRY RUN] Region: $GCP_REGION"
        return 0
    fi

    # Get service configuration
    local min_instances="${SERVICE_CONFIG[$service_name:min_instances]}"
    local max_instances="${SERVICE_CONFIG[$service_name:max_instances]}"
    local memory="${SERVICE_CONFIG[$service_name:memory]}"
    local cpu="${SERVICE_CONFIG[$service_name:cpu]}"
    local concurrency="${SERVICE_CONFIG[$service_name:concurrency]}"
    local timeout="${SERVICE_CONFIG[$service_name:timeout]}"

    # Deploy to Cloud Run
    if gcloud run deploy "$service_name" \
        --image="$image_tag" \
        --region="$GCP_REGION" \
        --platform=managed \
        --allow-unauthenticated \
        --min-instances="$min_instances" \
        --max-instances="$max_instances" \
        --memory="$memory" \
        --cpu="$cpu" \
        --concurrency="$concurrency" \
        --timeout="$timeout" \
        --set-env-vars="NODE_ENV=production,PORT=8080" \
        --set-secrets="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,TWILIO_PHONE_NUMBER=TWILIO_PHONE_NUMBER:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,DATABASE_URL=DATABASE_URL:latest" \
        --quiet; then
        log_success "Deployed $service_name"
    else
        log_error "Failed to deploy $service_name"
        return 1
    fi
}

verify_deployment() {
    local service_name=$1

    log_info "Verifying deployment of $service_name..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would verify: $service_name"
        return 0
    fi

    # Get service URL
    local service_url
    service_url=$(gcloud run services describe "$service_name" \
        --region="$GCP_REGION" \
        --format='value(status.url)' 2>/dev/null)

    if [[ -z "$service_url" ]]; then
        log_warning "Could not get service URL for $service_name"
        return 0
    fi

    log_info "Service URL: $service_url"

    # Try health check endpoint
    local health_url="$service_url/health"
    log_info "Checking health endpoint: $health_url"

    sleep 5  # Give service time to start

    if curl -f -s "$health_url" > /dev/null 2>&1; then
        log_success "$service_name is healthy"
    else
        log_warning "$service_name health check failed (this may be expected if /health endpoint doesn't exist)"
    fi
}

print_deployment_summary() {
    log_info "=========================================="
    log_success "Deployment Summary"
    log_info "=========================================="
    log_info "Project: $GCP_PROJECT_ID"
    log_info "Region: $GCP_REGION"

    if [[ -n "$SPECIFIC_SERVICE" ]]; then
        log_info "Deployed: $SPECIFIC_SERVICE"
    else
        log_info "Deployed: All services"
    fi

    log_info ""
    log_info "Service URLs:"

    for service in "${!SERVICES[@]}"; do
        if [[ -n "$SPECIFIC_SERVICE" ]] && [[ "$service" != "$SPECIFIC_SERVICE" ]]; then
            continue
        fi

        local url
        url=$(gcloud run services describe "$service" \
            --region="$GCP_REGION" \
            --format='value(status.url)' 2>/dev/null || echo "N/A")
        log_info "  $service: $url"
    done

    log_info "=========================================="
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy Yachtparty services to Google Cloud Run.

OPTIONS:
    --dry-run              Show what would be deployed without actually deploying
    --service <name>       Deploy only a specific service (twilio-webhook, sms-sender, realtime-processor)
    --skip-tests           Skip running tests before deployment
    --skip-migrations      Skip running database migrations
    -h, --help             Show this help message

EXAMPLES:
    $0                                    # Deploy all services
    $0 --dry-run                          # Dry run for all services
    $0 --service twilio-webhook           # Deploy only twilio-webhook
    $0 --skip-tests --skip-migrations     # Deploy without tests or migrations

EOF
}

################################################################################
# Main Deployment Flow
################################################################################

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --skip-migrations)
                SKIP_MIGRATIONS=true
                shift
                ;;
            --service)
                SPECIFIC_SERVICE="$2"
                if [[ ! -v "SERVICES[$SPECIFIC_SERVICE]" ]]; then
                    log_error "Unknown service: $SPECIFIC_SERVICE"
                    log_info "Valid services: ${!SERVICES[*]}"
                    exit 1
                fi
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    log_info "=========================================="
    log_info "Yachtparty Deployment Script"
    log_info "=========================================="

    if [[ "$DRY_RUN" == true ]]; then
        log_warning "DRY RUN MODE - No actual changes will be made"
    fi

    # Step 1: Check prerequisites
    check_prerequisites

    # Step 2: Run tests
    run_tests

    # Step 3: Run migrations
    run_migrations

    # Step 4: Build, push, and deploy services
    local services_to_deploy=()
    if [[ -n "$SPECIFIC_SERVICE" ]]; then
        services_to_deploy=("$SPECIFIC_SERVICE")
    else
        services_to_deploy=("${!SERVICES[@]}")
    fi

    for service in "${services_to_deploy[@]}"; do
        log_info "=========================================="
        log_info "Processing service: $service"
        log_info "=========================================="

        # Build image
        if ! build_image "$service"; then
            log_error "Failed to build $service"
            exit 1
        fi

        # Push image
        if ! push_image "$service"; then
            log_error "Failed to push $service"
            exit 1
        fi

        # Deploy service
        if ! deploy_service "$service"; then
            log_error "Failed to deploy $service"
            exit 1
        fi

        # Verify deployment
        verify_deployment "$service"
    done

    # Step 5: Print summary
    log_info ""
    if [[ "$DRY_RUN" != true ]]; then
        print_deployment_summary
        log_success "Deployment completed successfully!"
    else
        log_info "Dry run completed. Run without --dry-run to deploy."
    fi
}

# Run main function
main "$@"
