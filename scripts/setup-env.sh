#!/bin/bash
################################################################################
# Yachtparty Environment Setup Script
#
# Interactive script to help set up environment variables for all services.
# Creates .env files for each service with proper configuration.
#
# Usage:
#   ./scripts/setup-env.sh                 # Interactive setup
#   ./scripts/setup-env.sh --dev           # Use development defaults
#   ./scripts/setup-env.sh --validate      # Validate existing .env files
#
################################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Mode
MODE="interactive"
VALIDATE_ONLY=false

# Environment variables
declare -A ENV_VARS

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

log_prompt() {
    echo -e "${CYAN}[?]${NC} $1"
}

prompt_for_value() {
    local var_name=$1
    local description=$2
    local default_value=${3:-}
    local is_secret=${4:-false}

    local prompt_text="$description"
    if [[ -n "$default_value" ]]; then
        prompt_text="$prompt_text (default: $default_value)"
    fi

    if [[ "$is_secret" == true ]]; then
        prompt_text="$prompt_text [SECRET]"
    fi

    log_prompt "$prompt_text"
    echo -n "> "

    if [[ "$is_secret" == true ]]; then
        read -rs user_input
        echo  # New line after secret input
    else
        read -r user_input
    fi

    if [[ -z "$user_input" && -n "$default_value" ]]; then
        ENV_VARS[$var_name]="$default_value"
    elif [[ -n "$user_input" ]]; then
        ENV_VARS[$var_name]="$user_input"
    else
        ENV_VARS[$var_name]=""
    fi
}

validate_url() {
    local url=$1
    if [[ $url =~ ^https?:// ]]; then
        return 0
    else
        return 1
    fi
}

validate_phone() {
    local phone=$1
    if [[ $phone =~ ^\+[0-9]{10,15}$ ]]; then
        return 0
    else
        return 1
    fi
}

################################################################################
# Environment Collection Functions
################################################################################

collect_supabase_config() {
    log_info "=========================================="
    log_info "Supabase Configuration"
    log_info "=========================================="
    log_info "Get these values from: https://supabase.com/dashboard/project/_/settings/api"
    echo ""

    prompt_for_value "SUPABASE_URL" "Supabase Project URL" "https://your-project.supabase.co"

    if ! validate_url "${ENV_VARS[SUPABASE_URL]}"; then
        log_warning "URL should start with https://"
    fi

    prompt_for_value "SUPABASE_ANON_KEY" "Supabase Anon Key" "" true
    prompt_for_value "SUPABASE_SERVICE_KEY" "Supabase Service Role Key" "" true

    prompt_for_value "DATABASE_URL" "Database URL (PostgreSQL connection string)" \
        "postgresql://postgres:[PASSWORD]@db.your-project.supabase.co:5432/postgres"

    echo ""
}

collect_twilio_config() {
    log_info "=========================================="
    log_info "Twilio Configuration"
    log_info "=========================================="
    log_info "Get these values from: https://console.twilio.com/"
    echo ""

    prompt_for_value "TWILIO_ACCOUNT_SID" "Twilio Account SID" "" true
    prompt_for_value "TWILIO_AUTH_TOKEN" "Twilio Auth Token" "" true
    prompt_for_value "TWILIO_PHONE_NUMBER" "Twilio Phone Number" "+1234567890"

    if ! validate_phone "${ENV_VARS[TWILIO_PHONE_NUMBER]}"; then
        log_warning "Phone number should be in E.164 format (e.g., +12345678900)"
    fi

    echo ""
}

collect_anthropic_config() {
    log_info "=========================================="
    log_info "Anthropic Configuration"
    log_info "=========================================="
    log_info "Get your API key from: https://console.anthropic.com/"
    echo ""

    prompt_for_value "ANTHROPIC_API_KEY" "Anthropic API Key" "" true

    echo ""
}

collect_gcp_config() {
    log_info "=========================================="
    log_info "Google Cloud Platform Configuration"
    log_info "=========================================="
    log_info "These are needed for Cloud Run deployment"
    echo ""

    prompt_for_value "GCP_PROJECT_ID" "GCP Project ID" ""
    prompt_for_value "GCP_REGION" "GCP Region" "us-central1"

    echo ""
}

collect_optional_config() {
    log_info "=========================================="
    log_info "Optional Configuration"
    log_info "=========================================="
    log_info "These services are optional and can be added later"
    echo ""

    prompt_for_value "PERPLEXITY_API_KEY" "Perplexity API Key (optional)" ""
    prompt_for_value "APIFY_API_KEY" "Apify API Key (optional, for LinkedIn scraping)" ""
    prompt_for_value "MAILEROO_API_KEY" "Maileroo API Key (optional, for email verification)" ""

    echo ""
}

collect_app_config() {
    log_info "=========================================="
    log_info "Application Configuration"
    log_info "=========================================="
    echo ""

    local default_env="development"
    if [[ "$MODE" == "production" ]]; then
        default_env="production"
    fi

    prompt_for_value "NODE_ENV" "Node Environment" "$default_env"
    prompt_for_value "PORT" "Server Port" "8080"

    echo ""
}

################################################################################
# Environment File Creation
################################################################################

create_root_env() {
    local env_file="$PROJECT_ROOT/.env"

    log_info "Creating root .env file..."

    cat > "$env_file" << EOF
# Yachtparty Environment Configuration
# Generated on $(date)

# Supabase Configuration
SUPABASE_URL=${ENV_VARS[SUPABASE_URL]}
SUPABASE_ANON_KEY=${ENV_VARS[SUPABASE_ANON_KEY]}
SUPABASE_SERVICE_KEY=${ENV_VARS[SUPABASE_SERVICE_KEY]}
DATABASE_URL=${ENV_VARS[DATABASE_URL]}

# Twilio Configuration
TWILIO_ACCOUNT_SID=${ENV_VARS[TWILIO_ACCOUNT_SID]}
TWILIO_AUTH_TOKEN=${ENV_VARS[TWILIO_AUTH_TOKEN]}
TWILIO_PHONE_NUMBER=${ENV_VARS[TWILIO_PHONE_NUMBER]}

# Anthropic Claude API
ANTHROPIC_API_KEY=${ENV_VARS[ANTHROPIC_API_KEY]}

# Perplexity API (Optional)
PERPLEXITY_API_KEY=${ENV_VARS[PERPLEXITY_API_KEY]:-}

# Google Cloud Configuration
GCP_PROJECT_ID=${ENV_VARS[GCP_PROJECT_ID]:-}
GCP_REGION=${ENV_VARS[GCP_REGION]:-us-central1}

# Application Configuration
NODE_ENV=${ENV_VARS[NODE_ENV]:-development}
PORT=${ENV_VARS[PORT]:-8080}

# LinkedIn/Apify (Phase 3 - Optional)
APIFY_API_KEY=${ENV_VARS[APIFY_API_KEY]:-}

# Email Verification (Optional)
MAILEROO_API_KEY=${ENV_VARS[MAILEROO_API_KEY]:-}
VERIFICATION_EMAIL_DOMAIN=verify.yachtparty.xyz
EOF

    chmod 600 "$env_file"
    log_success "Created: $env_file"
}

create_service_env() {
    local service_name=$1
    local service_path="$PROJECT_ROOT/packages/services/$service_name"
    local env_file="$service_path/.env"

    if [[ ! -d "$service_path" ]]; then
        log_warning "Service directory not found: $service_path"
        return
    fi

    log_info "Creating .env for $service_name..."

    cat > "$env_file" << EOF
# $service_name Environment Configuration
# Generated on $(date)

NODE_ENV=${ENV_VARS[NODE_ENV]:-development}
PORT=${ENV_VARS[PORT]:-8080}

# Supabase
SUPABASE_URL=${ENV_VARS[SUPABASE_URL]}
SUPABASE_SERVICE_KEY=${ENV_VARS[SUPABASE_SERVICE_KEY]}
DATABASE_URL=${ENV_VARS[DATABASE_URL]}

# Twilio
TWILIO_ACCOUNT_SID=${ENV_VARS[TWILIO_ACCOUNT_SID]}
TWILIO_AUTH_TOKEN=${ENV_VARS[TWILIO_AUTH_TOKEN]}
TWILIO_PHONE_NUMBER=${ENV_VARS[TWILIO_PHONE_NUMBER]}

# Anthropic
ANTHROPIC_API_KEY=${ENV_VARS[ANTHROPIC_API_KEY]}
EOF

    # Add optional configs if they exist
    if [[ -n "${ENV_VARS[PERPLEXITY_API_KEY]:-}" ]]; then
        echo "PERPLEXITY_API_KEY=${ENV_VARS[PERPLEXITY_API_KEY]}" >> "$env_file"
    fi

    chmod 600 "$env_file"
    log_success "Created: $env_file"
}

create_database_env() {
    local env_file="$PROJECT_ROOT/packages/database/.env"

    log_info "Creating .env for database package..."

    cat > "$env_file" << EOF
# Database Package Environment Configuration
# Generated on $(date)

DATABASE_URL=${ENV_VARS[DATABASE_URL]}
SUPABASE_URL=${ENV_VARS[SUPABASE_URL]}
SUPABASE_SERVICE_KEY=${ENV_VARS[SUPABASE_SERVICE_KEY]}
EOF

    chmod 600 "$env_file"
    log_success "Created: $env_file"
}

################################################################################
# Validation Functions
################################################################################

validate_env_file() {
    local env_file=$1
    local missing_vars=()

    if [[ ! -f "$env_file" ]]; then
        log_error "File not found: $env_file"
        return 1
    fi

    log_info "Validating: $env_file"

    # Required variables
    local required_vars=(
        "SUPABASE_URL"
        "SUPABASE_SERVICE_KEY"
        "TWILIO_ACCOUNT_SID"
        "TWILIO_AUTH_TOKEN"
        "TWILIO_PHONE_NUMBER"
        "ANTHROPIC_API_KEY"
        "DATABASE_URL"
    )

    # Source the env file
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a

    # Check each required variable
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        return 1
    else
        log_success "All required variables present"
        return 0
    fi
}

validate_all_envs() {
    log_info "=========================================="
    log_info "Validating Environment Files"
    log_info "=========================================="
    echo ""

    local all_valid=true

    # Validate root .env
    if ! validate_env_file "$PROJECT_ROOT/.env"; then
        all_valid=false
    fi
    echo ""

    # Validate service .env files
    for service in twilio-webhook sms-sender realtime-processor; do
        local env_file="$PROJECT_ROOT/packages/services/$service/.env"
        if [[ -f "$env_file" ]]; then
            if ! validate_env_file "$env_file"; then
                all_valid=false
            fi
        else
            log_warning ".env not found for $service"
            all_valid=false
        fi
        echo ""
    done

    # Validate database .env
    if [[ -f "$PROJECT_ROOT/packages/database/.env" ]]; then
        if ! validate_env_file "$PROJECT_ROOT/packages/database/.env"; then
            all_valid=false
        fi
    else
        log_warning ".env not found for database package"
        all_valid=false
    fi

    if [[ "$all_valid" == true ]]; then
        log_success "All environment files are valid!"
        return 0
    else
        log_error "Some environment files are missing or invalid"
        return 1
    fi
}

################################################################################
# Main Function
################################################################################

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Interactive environment setup for Yachtparty services.

OPTIONS:
    --dev              Use development defaults
    --validate         Validate existing .env files
    -h, --help         Show this help message

EXAMPLES:
    $0                 # Interactive setup
    $0 --dev           # Quick setup with dev defaults
    $0 --validate      # Validate existing configuration

EOF
}

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dev)
                MODE="development"
                shift
                ;;
            --validate)
                VALIDATE_ONLY=true
                shift
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
    log_info "Yachtparty Environment Setup"
    log_info "=========================================="
    echo ""

    # If validate only, run validation and exit
    if [[ "$VALIDATE_ONLY" == true ]]; then
        validate_all_envs
        exit $?
    fi

    # Welcome message
    log_info "This script will help you set up environment variables for all services."
    log_info "You can press Enter to use default values where provided."
    log_warning "Secret values will not be displayed as you type."
    echo ""

    if [[ "$MODE" == "development" ]]; then
        log_info "Using development mode with sensible defaults"
        echo ""
    fi

    # Collect all configuration
    collect_supabase_config
    collect_twilio_config
    collect_anthropic_config
    collect_gcp_config
    collect_optional_config
    collect_app_config

    # Confirm before writing
    log_info "=========================================="
    log_info "Review Configuration"
    log_info "=========================================="
    echo ""
    log_info "The following .env files will be created:"
    echo "  - $PROJECT_ROOT/.env"
    echo "  - $PROJECT_ROOT/packages/services/twilio-webhook/.env"
    echo "  - $PROJECT_ROOT/packages/services/sms-sender/.env"
    echo "  - $PROJECT_ROOT/packages/services/realtime-processor/.env"
    echo "  - $PROJECT_ROOT/packages/database/.env"
    echo ""
    log_warning "Existing files will be overwritten!"
    echo ""
    read -rp "Continue? (y/N) " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi

    # Create all .env files
    log_info ""
    log_info "Creating environment files..."
    echo ""

    create_root_env
    create_service_env "twilio-webhook"
    create_service_env "sms-sender"
    create_service_env "realtime-processor"
    create_database_env

    # Summary
    echo ""
    log_info "=========================================="
    log_success "Environment Setup Complete!"
    log_info "=========================================="
    echo ""
    log_info "Next steps:"
    echo "  1. Review the generated .env files"
    echo "  2. Update any placeholder values"
    echo "  3. Run: ./scripts/local-dev.sh to start local development"
    echo "  4. Run: ./scripts/deploy.sh to deploy to production"
    echo ""
    log_info "To validate your configuration:"
    echo "  ./scripts/setup-env.sh --validate"
    echo ""
}

# Run main function
main "$@"
