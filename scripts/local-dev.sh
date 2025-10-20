#!/bin/bash
################################################################################
# Yachtparty Local Development Helper Script
#
# This script helps manage the local development environment using Docker Compose.
# It handles starting services, running migrations, and monitoring logs.
#
# Usage:
#   ./scripts/local-dev.sh                     # Start all services
#   ./scripts/local-dev.sh --logs              # Follow logs after starting
#   ./scripts/local-dev.sh --rebuild           # Rebuild images before starting
#   ./scripts/local-dev.sh stop                # Stop all services
#   ./scripts/local-dev.sh restart             # Restart all services
#   ./scripts/local-dev.sh logs <service>      # View logs for specific service
#   ./scripts/local-dev.sh shell <service>     # Open shell in service container
#   ./scripts/local-dev.sh db                  # Open PostgreSQL shell
#   ./scripts/local-dev.sh migrate             # Run database migrations
#   ./scripts/local-dev.sh status              # Show status of all services
#   ./scripts/local-dev.sh clean               # Stop and remove all containers/volumes
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

# Docker Compose file
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"

# Options
FOLLOW_LOGS=false
REBUILD=false

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

log_step() {
    echo -e "${CYAN}==>${NC} $1"
}

check_prerequisites() {
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install it from: https://docs.docker.com/get-docker/"
        exit 1
    fi

    # Check if Docker Compose is available
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available. Please update Docker."
        exit 1
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi

    # Check if .env file exists
    if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
        log_warning ".env file not found!"
        log_info "Run: ./scripts/setup-env.sh to create environment configuration"
        read -rp "Continue without .env? (y/N) " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

wait_for_postgres() {
    log_step "Waiting for PostgreSQL to be ready..."

    local max_attempts=30
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U postgres &> /dev/null; then
            log_success "PostgreSQL is ready!"
            return 0
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 1
    done

    echo ""
    log_error "PostgreSQL failed to become ready in time"
    return 1
}

################################################################################
# Service Management Functions
################################################################################

start_services() {
    log_info "=========================================="
    log_info "Starting Yachtparty Development Environment"
    log_info "=========================================="
    echo ""

    check_prerequisites

    local compose_args=()

    if [[ "$REBUILD" == true ]]; then
        log_step "Rebuilding Docker images..."
        compose_args+=("--build")
    fi

    log_step "Starting services..."

    if docker compose -f "$COMPOSE_FILE" up -d "${compose_args[@]}"; then
        log_success "Services started successfully!"
    else
        log_error "Failed to start services"
        exit 1
    fi

    # Wait for PostgreSQL
    wait_for_postgres

    # Run migrations
    run_migrations

    # Show status
    show_status

    echo ""
    log_info "=========================================="
    log_success "Development Environment Ready!"
    log_info "=========================================="
    echo ""
    log_info "Service URLs:"
    echo "  - Twilio Webhook:      http://localhost:8081"
    echo "  - SMS Sender:          http://localhost:8082"
    echo "  - Realtime Processor:  http://localhost:8083"
    echo "  - PostgreSQL:          localhost:5432"
    echo "  - pgAdmin:             http://localhost:5050 (optional, use --profile tools)"
    echo ""
    log_info "Useful commands:"
    echo "  - View logs:           ./scripts/local-dev.sh logs"
    echo "  - Stop services:       ./scripts/local-dev.sh stop"
    echo "  - Database shell:      ./scripts/local-dev.sh db"
    echo "  - Run migrations:      ./scripts/local-dev.sh migrate"
    echo ""

    if [[ "$FOLLOW_LOGS" == true ]]; then
        log_step "Following logs (Ctrl+C to stop)..."
        docker compose -f "$COMPOSE_FILE" logs -f
    fi
}

stop_services() {
    log_info "Stopping services..."

    if docker compose -f "$COMPOSE_FILE" down; then
        log_success "Services stopped successfully!"
    else
        log_error "Failed to stop services"
        exit 1
    fi
}

restart_services() {
    log_info "Restarting services..."
    stop_services
    echo ""
    start_services
}

show_status() {
    log_info "=========================================="
    log_info "Service Status"
    log_info "=========================================="
    echo ""

    docker compose -f "$COMPOSE_FILE" ps
}

show_logs() {
    local service=${1:-}
    local follow=${2:-false}

    if [[ -z "$service" ]]; then
        log_info "Showing logs for all services..."
        if [[ "$follow" == true ]]; then
            docker compose -f "$COMPOSE_FILE" logs -f
        else
            docker compose -f "$COMPOSE_FILE" logs --tail=100
        fi
    else
        log_info "Showing logs for $service..."
        if [[ "$follow" == true ]]; then
            docker compose -f "$COMPOSE_FILE" logs -f "$service"
        else
            docker compose -f "$COMPOSE_FILE" logs --tail=100 "$service"
        fi
    fi
}

open_shell() {
    local service=${1:-}

    if [[ -z "$service" ]]; then
        log_error "Please specify a service name"
        log_info "Available services: twilio-webhook, sms-sender, realtime-processor, postgres"
        exit 1
    fi

    log_info "Opening shell in $service container..."

    # Determine shell to use
    local shell_cmd="sh"
    if [[ "$service" == "postgres" ]]; then
        docker compose -f "$COMPOSE_FILE" exec "$service" bash
    else
        docker compose -f "$COMPOSE_FILE" exec "$service" sh
    fi
}

open_db_shell() {
    log_info "Opening PostgreSQL shell..."
    docker compose -f "$COMPOSE_FILE" exec postgres psql -U postgres -d yachtparty_dev
}

run_migrations() {
    log_step "Running database migrations..."

    cd "$PROJECT_ROOT"

    # Make sure we have the database package dependencies
    if [[ ! -d "$PROJECT_ROOT/packages/database/node_modules" ]]; then
        log_info "Installing database package dependencies..."
        cd "$PROJECT_ROOT/packages/database"
        npm install
        cd "$PROJECT_ROOT"
    fi

    # Set DATABASE_URL for local development
    export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/yachtparty_dev"

    # Run migrations
    if npm run db:migrate; then
        log_success "Database migrations completed!"
    else
        log_warning "Database migrations failed (this may be expected if already applied)"
    fi
}

clean_environment() {
    log_warning "This will stop and remove all containers, networks, and volumes!"
    read -rp "Are you sure? (y/N) " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Clean cancelled"
        exit 0
    fi

    log_info "Cleaning environment..."

    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans

    log_success "Environment cleaned!"
    log_info "All containers, networks, and volumes have been removed."
}

run_tests() {
    log_info "Running tests..."

    cd "$PROJECT_ROOT"

    # Install dependencies if needed
    if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
        log_info "Installing dependencies..."
        npm install
    fi

    # Run tests
    if npm test; then
        log_success "All tests passed!"
    else
        log_error "Tests failed"
        exit 1
    fi
}

health_check() {
    log_info "=========================================="
    log_info "Health Check"
    log_info "=========================================="
    echo ""

    local services=("twilio-webhook:8081" "sms-sender:8082" "realtime-processor:8083")
    local all_healthy=true

    for service_port in "${services[@]}"; do
        IFS=':' read -r service port <<< "$service_port"

        echo -n "Checking $service... "

        if curl -f -s "http://localhost:$port/health" > /dev/null 2>&1; then
            echo -e "${GREEN}OK${NC}"
        else
            echo -e "${RED}FAILED${NC}"
            all_healthy=false
        fi
    done

    echo ""

    if [[ "$all_healthy" == true ]]; then
        log_success "All services are healthy!"
    else
        log_warning "Some services are not responding"
        log_info "This may be expected if services are still starting up"
    fi
}

################################################################################
# Main Function
################################################################################

usage() {
    cat << EOF
Usage: $0 [COMMAND] [OPTIONS]

Manage Yachtparty local development environment.

COMMANDS:
    start              Start all services (default)
    stop               Stop all services
    restart            Restart all services
    status             Show status of all services
    logs [service]     Show logs (all services or specific service)
    shell <service>    Open shell in service container
    db                 Open PostgreSQL shell
    migrate            Run database migrations
    test               Run tests
    health             Check health of all services
    clean              Stop and remove all containers/volumes

OPTIONS:
    --logs             Follow logs after starting services
    --rebuild          Rebuild Docker images before starting
    -h, --help         Show this help message

EXAMPLES:
    $0                                    # Start all services
    $0 --logs                             # Start and follow logs
    $0 --rebuild                          # Rebuild and start
    $0 stop                               # Stop services
    $0 logs twilio-webhook                # View twilio-webhook logs
    $0 shell postgres                     # Open shell in postgres container
    $0 db                                 # Open PostgreSQL shell
    $0 migrate                            # Run database migrations
    $0 clean                              # Clean everything

EOF
}

main() {
    local command="start"

    # Parse command
    if [[ $# -gt 0 ]] && [[ ! "$1" =~ ^-- ]]; then
        command=$1
        shift
    fi

    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --logs)
                FOLLOW_LOGS=true
                shift
                ;;
            --rebuild)
                REBUILD=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                # Could be a service name for logs/shell commands
                break
                ;;
        esac
    done

    # Execute command
    case $command in
        start)
            start_services
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs "${1:-}" true
            ;;
        shell)
            open_shell "${1:-}"
            ;;
        db)
            open_db_shell
            ;;
        migrate)
            run_migrations
            ;;
        test)
            run_tests
            ;;
        health)
            health_check
            ;;
        clean)
            clean_environment
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
