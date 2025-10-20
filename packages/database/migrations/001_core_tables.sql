-- =====================================================
-- Yachtparty Core Database Tables Migration
-- File: 001_core_tables.sql
-- Description: Core tables for the Yachtparty multi-agent system
-- Based on: requirements.md Section 3.1
-- =====================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- TABLE: users
-- Description: Primary user records for all platform participants
-- =====================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  company VARCHAR(255),
  title VARCHAR(255),
  linkedin_url VARCHAR(500),

  -- User classification
  verified BOOLEAN DEFAULT FALSE,
  innovator BOOLEAN DEFAULT FALSE,
  expert_connector BOOLEAN DEFAULT FALSE,
  expertise TEXT[], -- Areas user can help with

  -- Agent assignment
  poc_agent_id VARCHAR(50), -- ID of primary agent (bouncer/concierge/innovator)
  poc_agent_type VARCHAR(50), -- 'bouncer', 'concierge', 'innovator'

  -- User preferences
  quiet_hours_start TIME, -- Local time
  quiet_hours_end TIME,
  timezone VARCHAR(50),
  response_pattern JSONB, -- Learned patterns: best times to reach, preferred style

  -- Credits and status
  credit_balance INTEGER DEFAULT 0,
  status_level VARCHAR(50) DEFAULT 'member',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ
);

-- Indexes for users table
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_verified ON users(verified);
CREATE INDEX idx_users_poc_agent ON users(poc_agent_type, verified);

COMMENT ON TABLE users IS 'Primary user records for all platform participants';
COMMENT ON COLUMN users.poc_agent_id IS 'ID of primary agent instance that owns this user interface';
COMMENT ON COLUMN users.poc_agent_type IS 'Type of primary agent (bouncer/concierge/innovator) for quick filtering';
COMMENT ON COLUMN users.expertise IS 'Array of expertise areas for community request matching';
COMMENT ON COLUMN users.response_pattern IS 'JSONB store for ML-learned user behavior patterns';


-- =====================================================
-- TABLE: conversations
-- Description: Tracks ongoing conversation threads between users and the system
-- =====================================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  phone_number VARCHAR(20) NOT NULL, -- Denormalized for quick lookup
  status VARCHAR(50) DEFAULT 'active', -- active, paused, completed

  -- Context management
  conversation_summary TEXT, -- Periodic LLM-generated summary
  last_summary_message_id UUID,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ
);

-- Indexes for conversations table
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_phone ON conversations(phone_number);
CREATE INDEX idx_conversations_status ON conversations(status, updated_at);

COMMENT ON TABLE conversations IS 'Tracks ongoing conversation threads for context isolation';
COMMENT ON COLUMN conversations.phone_number IS 'Denormalized for webhook lookups (critical path optimization)';
COMMENT ON COLUMN conversations.conversation_summary IS 'LLM-generated summary to prevent context window explosion (summarize every 50 messages)';


-- =====================================================
-- TABLE: messages
-- Description: Individual messages in conversations
-- =====================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Message content
  role VARCHAR(50) NOT NULL, -- 'user', 'concierge', 'bouncer', 'innovator', 'system'
  content TEXT NOT NULL,

  -- Delivery tracking
  direction VARCHAR(20) NOT NULL, -- 'inbound', 'outbound'
  twilio_message_sid VARCHAR(100),
  status VARCHAR(50), -- 'queued', 'sent', 'delivered', 'failed'

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

-- Indexes for messages table
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_user ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_twilio ON messages(twilio_message_sid);

COMMENT ON TABLE messages IS 'Individual messages in conversations with delivery tracking';
COMMENT ON COLUMN messages.role IS 'Message sender role: user, concierge, bouncer, innovator, system';
COMMENT ON COLUMN messages.direction IS 'Message direction: inbound (from user) or outbound (to user)';
COMMENT ON COLUMN messages.twilio_message_sid IS 'Twilio message SID for delivery status tracking';


-- =====================================================
-- TABLE: events
-- Description: Event sourcing table - all system events for agent coordination
-- =====================================================

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL, -- 'user.message.received', 'solution.research_complete', etc.

  -- Event context
  aggregate_id UUID, -- ID of primary entity (user, intro, solution_request)
  aggregate_type VARCHAR(50), -- 'user', 'intro_opportunity', 'solution_request'

  -- Event data
  payload JSONB NOT NULL, -- Full event data
  metadata JSONB, -- Agent tracking, correlation IDs

  -- Processing tracking
  processed BOOLEAN DEFAULT FALSE,
  version INTEGER DEFAULT 1, -- For optimistic locking

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(100) -- Agent/function that created event
);

-- Indexes for events table
CREATE INDEX idx_events_type ON events(event_type, created_at DESC);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX idx_events_processed ON events(processed, created_at) WHERE NOT processed;
CREATE INDEX idx_events_created ON events(created_at DESC);

COMMENT ON TABLE events IS 'Event sourcing table providing complete audit trail and enabling replay';
COMMENT ON COLUMN events.aggregate_id IS 'ID of primary entity this event relates to';
COMMENT ON COLUMN events.aggregate_type IS 'Type of entity (user, intro_opportunity, solution_request)';
COMMENT ON COLUMN events.payload IS 'JSONB payload allows flexible event schemas without migrations';
COMMENT ON COLUMN events.processed IS 'Flag enables idempotent event processing';

-- Trigger for real-time event notification
CREATE OR REPLACE FUNCTION notify_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_events',
    json_build_object(
      'id', NEW.id,
      'event_type', NEW.event_type,
      'aggregate_id', NEW.aggregate_id,
      'payload', NEW.payload
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_event_created
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_event();

COMMENT ON FUNCTION notify_event IS 'Publishes event to PostgreSQL NOTIFY for real-time agent subscriptions';


-- =====================================================
-- TABLE: agent_tasks
-- Description: Task queue for scheduled and event-driven agent work
-- =====================================================

CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task classification
  task_type VARCHAR(100) NOT NULL, -- 're_engagement_check', 'process_community_request', etc.
  agent_type VARCHAR(50) NOT NULL, -- 'concierge', 'account_manager', 'solution_saga', etc.

  -- Task scope
  user_id UUID REFERENCES users(id),
  context_id UUID, -- Reference to related entity (conversation, intro, request)
  context_type VARCHAR(50), -- Type of context_id entity

  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium', -- 'urgent', 'high', 'medium', 'low'

  -- Processing state
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_attempted_at TIMESTAMPTZ,

  -- Task data
  context_json JSONB NOT NULL, -- All data needed to process task
  result_json JSONB, -- Result after processing
  error_log TEXT, -- Error details if failed

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(100), -- Agent/function that created task
  completed_at TIMESTAMPTZ
);

-- Indexes for agent_tasks table
CREATE INDEX idx_tasks_due ON agent_tasks(status, scheduled_for, priority) WHERE status = 'pending';
CREATE INDEX idx_tasks_agent ON agent_tasks(agent_type, status, scheduled_for);
CREATE INDEX idx_tasks_user ON agent_tasks(user_id, status);
CREATE INDEX idx_tasks_context ON agent_tasks(context_type, context_id);

COMMENT ON TABLE agent_tasks IS 'Task queue for scheduled and event-driven agent work with retry logic';
COMMENT ON COLUMN agent_tasks.context_json IS 'Contains everything needed to process task independently';
COMMENT ON COLUMN agent_tasks.priority IS 'Priority level: urgent, high, medium, low for queue ordering';
COMMENT ON INDEX idx_tasks_due IS 'Optimized for FOR UPDATE SKIP LOCKED query pattern to prevent duplicate processing';


-- =====================================================
-- TABLE: message_queue
-- Description: Outbound message queue managed by Message Orchestrator
-- =====================================================

CREATE TABLE message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  agent_id VARCHAR(100) NOT NULL, -- Agent instance that created message

  -- Message content (structured data from agents)
  message_data JSONB NOT NULL, -- Structured findings/updates
  final_message TEXT, -- Concierge-crafted prose (set after rendering)

  -- Scheduling and priority
  scheduled_for TIMESTAMPTZ NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',

  -- Message lifecycle
  status VARCHAR(50) DEFAULT 'queued', -- 'queued', 'approved', 'sent', 'superseded', 'cancelled'
  superseded_by_message_id UUID REFERENCES message_queue(id),
  superseded_reason VARCHAR(100),

  -- Context awareness
  conversation_context_id UUID REFERENCES conversations(id),
  requires_fresh_context BOOLEAN DEFAULT FALSE, -- Recheck relevance before sending

  -- Delivery tracking
  sent_at TIMESTAMPTZ,
  delivered_message_id UUID REFERENCES messages(id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for message_queue table
CREATE INDEX idx_queue_user_pending ON message_queue(user_id, status, scheduled_for)
  WHERE status IN ('queued', 'approved');
CREATE INDEX idx_queue_due ON message_queue(status, scheduled_for, priority)
  WHERE status = 'approved';

COMMENT ON TABLE message_queue IS 'Outbound message queue with rate limiting and priority management';
COMMENT ON COLUMN message_queue.message_data IS 'Structured agent output before rendering to prose';
COMMENT ON COLUMN message_queue.final_message IS 'Concierge-crafted prose message for delivery';
COMMENT ON COLUMN message_queue.superseded_by_message_id IS 'Tracks when messages become stale and are replaced';
COMMENT ON COLUMN message_queue.requires_fresh_context IS 'Flag to recheck message relevance before sending';


-- =====================================================
-- TABLE: user_message_budget
-- Description: Rate limiting for message frequency control
-- =====================================================

CREATE TABLE user_message_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  date DATE NOT NULL,

  -- Counters
  messages_sent INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,

  -- Limits (configurable per user)
  daily_limit INTEGER DEFAULT 5,
  hourly_limit INTEGER DEFAULT 2,

  -- User preferences
  quiet_hours_enabled BOOLEAN DEFAULT TRUE,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, date)
);

-- Indexes for user_message_budget table
CREATE INDEX idx_budget_user_date ON user_message_budget(user_id, date DESC);

COMMENT ON TABLE user_message_budget IS 'Rate limiting to prevent message fatigue with per-user customization';
COMMENT ON COLUMN user_message_budget.daily_limit IS 'Daily message limit, customizable per user (default 5)';
COMMENT ON COLUMN user_message_budget.hourly_limit IS 'Hourly message limit, customizable per user (default 2)';
COMMENT ON COLUMN user_message_budget.date IS 'Date for daily budget tracking';


-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 001_core_tables.sql completed successfully';
  RAISE NOTICE 'Created tables: users, conversations, messages, events, agent_tasks, message_queue, user_message_budget';
  RAISE NOTICE 'Created indexes for optimal query performance';
  RAISE NOTICE 'Created trigger: notify_event() for real-time event processing';
END $$;
