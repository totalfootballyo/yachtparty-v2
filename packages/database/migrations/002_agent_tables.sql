-- =============================================
-- Yachtparty Agent-Specific Tables Migration
-- Migration: 002_agent_tables.sql
-- Description: Agent-specific database tables for multi-agent system workflows
-- Dependencies: 001_core_tables.sql (users, conversations, messages, events, agent_tasks)
-- =============================================

-- =============================================
-- TABLE: user_priorities
-- Purpose: Account Manager's ranked list of items for each user
-- =============================================

CREATE TABLE user_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Priority item
  priority_rank INTEGER NOT NULL, -- 1 = highest
  item_type VARCHAR(50) NOT NULL, -- 'intro_opportunity', 'community_request', 'solution_update'
  item_id UUID NOT NULL, -- Reference to specific item
  value_score DECIMAL(5,2), -- Calculated value to user/network (0-100)

  -- Lifecycle
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'presented', 'actioned', 'expired'
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  presented_at TIMESTAMPTZ,

  -- Indexes
  UNIQUE (user_id, item_type, item_id)
);

CREATE INDEX idx_priorities_user_active
  ON user_priorities(user_id, status, priority_rank)
  WHERE status = 'active';


-- =============================================
-- TABLE: solution_workflows
-- Purpose: Saga state tracking for solution research workflows
-- =============================================

CREATE TABLE solution_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  request_description TEXT NOT NULL,
  category VARCHAR(100),

  -- Workflow state
  current_step VARCHAR(100) NOT NULL, -- 'initial_research', 'awaiting_experts', 'final_evaluation'
  status VARCHAR(50) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'cancelled'

  -- Research results (accumulated over workflow)
  perplexity_results JSONB,
  matched_innovators JSONB,
  community_insights JSONB,
  expert_recommendations JSONB,

  -- Decision tracking
  quality_threshold_met BOOLEAN DEFAULT FALSE,
  last_decision_at TIMESTAMPTZ,
  next_action VARCHAR(100),

  -- Saga coordination
  pending_tasks JSONB DEFAULT '[]'::jsonb, -- [{type, id, created_at}]
  completed_tasks JSONB DEFAULT '[]'::jsonb,
  conversation_log JSONB DEFAULT '[]'::jsonb, -- Decision history for debugging

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workflows_user
  ON solution_workflows(user_id, status);

CREATE INDEX idx_workflows_status
  ON solution_workflows(status, updated_at);


-- =============================================
-- TABLE: intro_opportunities
-- Purpose: Connection opportunities for users to make introductions
-- =============================================

CREATE TABLE intro_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parties involved
  connector_user_id UUID REFERENCES users(id) NOT NULL, -- User who can make intro
  innovator_id UUID REFERENCES users(id), -- If innovator is on platform
  prospect_id UUID, -- If prospect not yet on platform (references prospects table)

  -- Opportunity details
  prospect_name VARCHAR(255) NOT NULL,
  prospect_company VARCHAR(255),
  prospect_title VARCHAR(255),
  prospect_linkedin_url VARCHAR(500),
  innovator_name VARCHAR(255),

  -- Incentive
  bounty_credits INTEGER DEFAULT 50,

  -- Status tracking
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'pending', 'accepted', 'rejected', 'completed', 'removed'
  connector_response TEXT, -- User's feedback

  -- Feed reference (if presented via feed)
  feed_item_id UUID,

  -- Intro details (if accepted)
  intro_email VARCHAR(255), -- Generated unique email for confirmation
  intro_scheduled_at TIMESTAMPTZ,
  intro_completed_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_intros_connector
  ON intro_opportunities(connector_user_id, status);

CREATE INDEX idx_intros_innovator
  ON intro_opportunities(innovator_id, status);

CREATE INDEX idx_intros_status
  ON intro_opportunities(status, created_at DESC);


-- =============================================
-- TABLE: community_requests
-- Purpose: Requests for expert insights from community
-- =============================================

CREATE TABLE community_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request origin
  requesting_agent_type VARCHAR(50) NOT NULL, -- 'solution_saga', 'demand_agent'
  requesting_user_id UUID REFERENCES users(id), -- User who benefits
  context_id UUID, -- Parent workflow (e.g., solution_workflow_id)
  context_type VARCHAR(50),

  -- Request details
  question TEXT NOT NULL,
  category VARCHAR(100),
  expertise_needed TEXT[], -- Match against users.expertise

  -- Targeting
  target_user_ids UUID[], -- Specific experts to ask

  -- Status
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'responses_received', 'closed'
  responses_count INTEGER DEFAULT 0,

  -- Close the loop
  closed_loop_at TIMESTAMPTZ,
  closed_loop_message TEXT, -- Feedback to responders

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '7 days'
);

CREATE INDEX idx_requests_status
  ON community_requests(status, created_at);

CREATE INDEX idx_requests_context
  ON community_requests(context_type, context_id);

CREATE INDEX idx_requests_expertise
  ON community_requests USING GIN (expertise_needed);


-- =============================================
-- TABLE: community_responses
-- Purpose: Expert responses to community requests
-- =============================================

CREATE TABLE community_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES community_requests(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL, -- Expert who responded

  -- Response content
  response_text TEXT NOT NULL, -- Concierge summary
  verbatim_answer TEXT NOT NULL, -- Exact user words

  -- Value tracking
  usefulness_score INTEGER, -- 1-10, rated by requesting agent
  impact_description TEXT, -- How this helped

  -- Credits
  credits_awarded INTEGER,
  credited_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(50) DEFAULT 'provided', -- 'provided', 'rewarded', 'closed_loop'
  closed_loop_message TEXT, -- "Your insight helped X solve Y"
  closed_loop_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_responses_request
  ON community_responses(request_id, created_at);

CREATE INDEX idx_responses_user
  ON community_responses(user_id, status);

CREATE INDEX idx_responses_status
  ON community_responses(status, created_at);


-- =============================================
-- TABLE: credit_events
-- Purpose: Event sourcing for credits (prevents double-spending)
-- =============================================

CREATE TABLE credit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Transaction details
  event_type VARCHAR(100) NOT NULL, -- 'intro_completed', 'community_response', 'referral_joined'
  amount INTEGER NOT NULL, -- Can be negative for spending

  -- Idempotency
  reference_type VARCHAR(50) NOT NULL, -- 'intro_opportunity', 'community_response'
  reference_id UUID NOT NULL,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL, -- Prevents duplicates

  -- Audit
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_credits_user
  ON credit_events(user_id, created_at DESC);

CREATE INDEX idx_credits_reference
  ON credit_events(reference_type, reference_id);

CREATE UNIQUE INDEX idx_credits_idempotency
  ON credit_events(idempotency_key);


-- =============================================
-- VIEW: user_credit_balances
-- Purpose: Computed view of user credit balances (single source of truth)
-- =============================================

CREATE VIEW user_credit_balances AS
SELECT
  user_id,
  SUM(amount) as balance,
  COUNT(*) as transaction_count,
  MAX(created_at) as last_transaction_at
FROM credit_events
WHERE processed = true
GROUP BY user_id;


-- =============================================
-- TRIGGER: Update user credit cache
-- Purpose: Update users.credit_balance when credit_events are processed
-- Note: View is source of truth, users.credit_balance is cached value
-- =============================================

CREATE OR REPLACE FUNCTION update_user_credit_cache()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET credit_balance = (
    SELECT COALESCE(SUM(amount), 0)
    FROM credit_events
    WHERE user_id = NEW.user_id AND processed = true
  )
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_credit_event_processed
  AFTER INSERT OR UPDATE ON credit_events
  FOR EACH ROW
  WHEN (NEW.processed = true)
  EXECUTE FUNCTION update_user_credit_cache();


-- =============================================
-- END OF MIGRATION: 002_agent_tables.sql
-- =============================================
