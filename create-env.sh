#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         Yachtparty Environment Variables Setup                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Default values
PROJECT_URL="https://wdjmhpmwiunkltkodbqh.supabase.co"

echo "Please provide your API credentials:"
echo ""

# Get Supabase credentials
read -p "SUPABASE_URL [$PROJECT_URL]: " SUPABASE_URL
SUPABASE_URL=${SUPABASE_URL:-$PROJECT_URL}

echo ""
echo "Get your service_role key from:"
echo "https://supabase.com/dashboard/project/wdjmhpmwiunkltkodbqh/settings/api"
echo ""
read -p "SUPABASE_SERVICE_KEY (paste the long JWT token): " SUPABASE_SERVICE_KEY

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo "❌ Error: SUPABASE_SERVICE_KEY is required"
    exit 1
fi

echo ""
echo "Get your Anthropic API key from:"
echo "https://console.anthropic.com/settings/keys"
echo ""
read -p "ANTHROPIC_API_KEY (starts with sk-ant-): " ANTHROPIC_API_KEY

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ Error: ANTHROPIC_API_KEY is required"
    exit 1
fi

echo ""
echo "Creating .env files..."
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
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    ✅ Setup Complete!                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Test the Bouncer agent:"
echo "   cd packages/agents/bouncer"
echo "   npm run test-chat"
echo ""
echo "2. Start a test conversation:"
echo "   You: Hi, I'd like to join Yachtparty"
echo ""
