-- Migration 003: Supporting Tables
-- Creates prospects, innovators, agent_instances, and agent_actions_log tables
-- Also adds messages_since_summary column to conversations table

-- =============================================
-- 1. PROSPECTS TABLE
-- =============================================
-- Individuals not yet on platform (targets for intros/demand gen)

CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  title VARCHAR(255),
  linkedin_url VARCHAR(500),
  email VARCHAR(255),

  -- Research results
  mutual_connections JSONB,
  last_researched_at TIMESTAMPTZ,

  -- Tracking
  users_researching UUID[],

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for prospects
CREATE INDEX idx_prospects_linkedin ON prospects (linkedin_url);


-- =============================================
-- 2. INNOVATORS TABLE
-- =============================================
-- Companies offering solutions (subset of users with extended profile)

CREATE TABLE innovators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,

  -- Company details
  company_name VARCHAR(255) NOT NULL,
  solution_description TEXT,
  categories TEXT[],
  target_customer_profile TEXT,

  -- Video pitch
  video_url VARCHAR(500),

  -- Status
  credits_balance INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for innovators
CREATE INDEX idx_innovators_categories ON innovators USING GIN (categories);
CREATE INDEX idx_innovators_active ON innovators (active, created_at DESC);


-- =============================================
-- 3. AGENT_INSTANCES TABLE
-- =============================================
-- Tracks agent configuration versions (for debugging/monitoring)
-- Purpose: Configuration versioning - tracks which prompt version, model, and
-- configuration was used for each agent deployment

CREATE TABLE agent_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),

  -- Configuration versioning
  config_json JSONB,
  prompt_version VARCHAR(50),

  -- Status
  status VARCHAR(50) DEFAULT 'active',
  last_active_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),
  terminated_at TIMESTAMPTZ
);

-- Create indexes for agent_instances
CREATE INDEX idx_instances_type_user ON agent_instances (agent_type, user_id);
CREATE INDEX idx_instances_active ON agent_instances (agent_type, status) WHERE status = 'active';


-- =============================================
-- 4. AGENT_ACTIONS_LOG TABLE
-- =============================================
-- Comprehensive logging for debugging and cost tracking

CREATE TABLE agent_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Agent context
  agent_type VARCHAR(50) NOT NULL,
  agent_instance_id UUID REFERENCES agent_instances(id),
  action_type VARCHAR(100) NOT NULL,

  -- Request context
  user_id UUID REFERENCES users(id),
  context_id UUID,
  context_type VARCHAR(50),

  -- LLM metrics
  model_used VARCHAR(100),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd DECIMAL(10,6),
  latency_ms INTEGER,

  -- Execution details
  input_data JSONB,
  output_data JSONB,
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for agent_actions_log
CREATE INDEX idx_log_agent_time ON agent_actions_log (agent_type, created_at DESC);
CREATE INDEX idx_log_user ON agent_actions_log (user_id, created_at DESC);
CREATE INDEX idx_log_cost ON agent_actions_log (created_at, cost_usd) WHERE cost_usd IS NOT NULL;


-- =============================================
-- 5. ALTER CONVERSATIONS TABLE
-- =============================================
-- Add messages_since_summary column for conversation summarization tracking

ALTER TABLE conversations ADD COLUMN messages_since_summary INTEGER DEFAULT 0;


-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE prospects IS 'Individuals not yet on platform, targets for introductions and demand generation';
COMMENT ON COLUMN prospects.users_researching IS 'Array of user IDs interested in connecting with this prospect';
COMMENT ON COLUMN prospects.mutual_connections IS 'LinkedIn mutual connections data from research';

COMMENT ON TABLE innovators IS 'Companies offering solutions - extended profile for users classified as innovators';
COMMENT ON COLUMN innovators.categories IS 'Array of solution categories for matching';
COMMENT ON COLUMN innovators.credits_balance IS 'Separate credit balance from user credits, used for intro bounties';

COMMENT ON TABLE agent_instances IS 'Tracks agent configuration versions for debugging and A/B testing';
COMMENT ON COLUMN agent_instances.prompt_version IS 'Version identifier like "bouncer_v1.2" or "concierge_v2.0"';
COMMENT ON COLUMN agent_instances.config_json IS 'Model parameters, feature flags, and configuration settings';

COMMENT ON TABLE agent_actions_log IS 'Comprehensive logging of all agent actions for debugging and cost tracking';
COMMENT ON COLUMN agent_actions_log.action_type IS 'Type of action: "llm_call", "function_execution", "event_published"';
COMMENT ON COLUMN agent_actions_log.cost_usd IS 'Calculated cost for LLM calls based on token usage';

COMMENT ON COLUMN conversations.messages_since_summary IS 'Counter for messages since last summarization, triggers summary at 50';
