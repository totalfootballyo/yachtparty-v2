#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         Yachtparty Supabase Setup Assistant                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

PROJECT_ID="wdjmhpmwiunkltkodbqh"
PROJECT_URL="https://${PROJECT_ID}.supabase.co"

echo "📋 Your Supabase Project:"
echo "   Project ID: $PROJECT_ID"
echo "   Project URL: $PROJECT_URL"
echo ""

# Check if combined migration exists
if [ ! -f "packages/database/combined_migration.sql" ]; then
    echo "❌ Error: combined_migration.sql not found"
    echo "   Creating it now..."
    cd packages/database
    cat migrations/001_core_tables.sql migrations/002_agent_tables.sql migrations/003_supporting_tables.sql migrations/004_triggers.sql > combined_migration.sql
    cd ../..
    echo "   ✅ Created combined_migration.sql"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Run Database Migrations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Choose your preferred method:"
echo ""
echo "Option A - SQL Editor (Recommended, easiest)"
echo "  1. Open: https://supabase.com/dashboard/project/${PROJECT_ID}/sql/new"
echo "  2. Copy contents of: packages/database/combined_migration.sql"
echo "  3. Paste into SQL Editor"
echo "  4. Click 'Run' or press Cmd+Enter"
echo ""
echo "Option B - Command Line (psql)"
echo "  You'll need your database password from:"
echo "  https://supabase.com/dashboard/project/${PROJECT_ID}/settings/database"
echo ""

read -p "Have you completed the migrations? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Please complete the migrations first, then run this script again."
    exit 0
fi

echo ""
echo "✅ Great! Migrations completed."
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Get API Credentials"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Opening Supabase API settings in your browser..."
echo "URL: https://supabase.com/dashboard/project/${PROJECT_ID}/settings/api"
echo ""
sleep 2
open "https://supabase.com/dashboard/project/${PROJECT_ID}/settings/api" 2>/dev/null || echo "(Please open the URL manually if it didn't open)"
echo ""
echo "You need to copy TWO values from that page:"
echo "  1. Project URL (under 'Project URL')"
echo "  2. service_role key (under 'Project API keys' → service_role)"
echo ""
echo "⚠️  IMPORTANT: Copy the 'service_role' key, NOT the 'anon' key!"
echo ""

read -p "Press Enter when you have both values ready..."
echo ""

# Get Supabase credentials
echo "Enter your Supabase credentials:"
echo ""

read -p "SUPABASE_URL [$PROJECT_URL]: " SUPABASE_URL
SUPABASE_URL=${SUPABASE_URL:-$PROJECT_URL}

echo ""
read -p "SUPABASE_SERVICE_KEY (paste the long JWT token): " SUPABASE_SERVICE_KEY

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo "❌ Error: SUPABASE_SERVICE_KEY cannot be empty"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3: Get Anthropic API Key"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if they already have an Anthropic key
if [ -f ".env" ] && grep -q "ANTHROPIC_API_KEY" .env 2>/dev/null; then
    EXISTING_KEY=$(grep "ANTHROPIC_API_KEY" .env | cut -d '=' -f2)
    if [ ! -z "$EXISTING_KEY" ] && [ "$EXISTING_KEY" != "sk-ant-api03-..." ]; then
        read -p "Found existing ANTHROPIC_API_KEY. Use it? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ANTHROPIC_API_KEY="$EXISTING_KEY"
        fi
    fi
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Get your Anthropic API key from:"
    echo "  https://console.anthropic.com/settings/keys"
    echo ""
    echo "If you don't have an account:"
    echo "  1. Sign up at https://console.anthropic.com/"
    echo "  2. Go to Settings → API Keys"
    echo "  3. Create a new key"
    echo ""

    read -p "ANTHROPIC_API_KEY (starts with sk-ant-): " ANTHROPIC_API_KEY

    if [ -z "$ANTHROPIC_API_KEY" ]; then
        echo "⚠️  Warning: No Anthropic API key provided."
        echo "   You'll need to add it to .env files manually before testing."
        ANTHROPIC_API_KEY="sk-ant-api03-YOUR_KEY_HERE"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 4: Creating .env Files"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create root .env
cat > .env << EOF
# Supabase
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY

# Anthropic
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY

# Agent Configuration
BOUNCER_AGENT_ID=bouncer_v1
PROMPT_VERSION=bouncer_v1.0
EOF

echo "✅ Created .env in project root"

# Create bouncer .env
mkdir -p packages/agents/bouncer
cat > packages/agents/bouncer/.env << EOF
# Supabase
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY

# Anthropic
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY

# Agent Configuration
BOUNCER_AGENT_ID=bouncer_v1
PROMPT_VERSION=bouncer_v1.0
EOF

echo "✅ Created .env in packages/agents/bouncer/"

# Create database .env
mkdir -p packages/database
cat > packages/database/.env << EOF
# Supabase
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
EOF

echo "✅ Created .env in packages/database/"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 5: Install Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    🎉 Setup Complete!                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Test the Bouncer agent:"
echo "   cd packages/agents/bouncer"
echo "   npm run test-chat"
echo ""
echo "2. Try a test conversation:"
echo "   You: Hi, I'd like to join Yachtparty"
echo "   You: I'm John Smith, VP of Engineering at Acme Corp"
echo "   You: john.smith@acme.com"
echo ""
echo "3. Verify in Supabase:"
echo "   https://supabase.com/dashboard/project/${PROJECT_ID}/editor"
echo ""
echo "📚 Need help? Check:"
echo "   - packages/database/MIGRATION_GUIDE.md"
echo "   - packages/agents/bouncer/TEST-SETUP.md"
echo "   - packages/agents/bouncer/README.md"
echo ""
