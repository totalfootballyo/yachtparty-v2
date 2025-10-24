


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."check_conversation_summary"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Increment counter
  UPDATE conversations
  SET messages_since_summary = messages_since_summary + 1
  WHERE id = NEW.conversation_id;

  -- Check if summarization needed (every 50 messages)
  IF (SELECT messages_since_summary FROM conversations WHERE id = NEW.conversation_id) >= 50 THEN
    -- Create task for summarization
    INSERT INTO agent_tasks (
      task_type,
      agent_type,
      scheduled_for,
      priority,
      context_json,
      created_by
    ) VALUES (
      'create_conversation_summary',
      'system',
      now(),
      'medium',
      jsonb_build_object('conversation_id', NEW.conversation_id),
      'conversation_summary_trigger'
    );

    -- Reset counter
    UPDATE conversations
    SET messages_since_summary = 0
    WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_conversation_summary"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."prospects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text",
    "phone_number" "text",
    "linkedin_url" "text",
    "first_name" "text",
    "last_name" "text",
    "company" "text",
    "title" "text",
    "innovator_id" "uuid" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "upload_source" "text",
    "upload_batch_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "converted_to_user_id" "uuid",
    "converted_at" timestamp with time zone,
    "prospect_notes" "text",
    "target_solution_categories" "text"[],
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "at_least_one_contact_method" CHECK ((("email" IS NOT NULL) OR ("phone_number" IS NOT NULL) OR ("linkedin_url" IS NOT NULL)))
);


ALTER TABLE "public"."prospects" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_matching_prospects"("p_email" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_linkedin" "text" DEFAULT NULL::"text", "p_status" "text" DEFAULT 'pending'::"text") RETURNS SETOF "public"."prospects"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM prospects
  WHERE status = p_status
    AND (
      (p_email IS NOT NULL AND email = p_email) OR
      (p_phone IS NOT NULL AND phone_number = p_phone) OR
      (p_linkedin IS NOT NULL AND linkedin_url = p_linkedin)
    )
  ORDER BY uploaded_at ASC;
END;
$$;


ALTER FUNCTION "public"."find_matching_prospects"("p_email" "text", "p_phone" "text", "p_linkedin" "text", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_phone_number_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.phone_number != OLD.phone_number THEN
    -- Archive old number in history
    UPDATE users
    SET phone_number_history = phone_number_history || jsonb_build_object(
      'phone_number', OLD.phone_number,
      'changed_at', now(),
      'changed_reason', 'user_update'
    )
    WHERE id = NEW.id;

    -- Close all active conversations with old phone number
    UPDATE conversations
    SET status = 'closed',
        updated_at = now()
    WHERE phone_number = OLD.phone_number
      AND user_id = NEW.id
      AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_phone_number_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."notify_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_event"() IS 'Publishes event to PostgreSQL NOTIFY for real-time agent subscriptions';



CREATE OR REPLACE FUNCTION "public"."send_sms_webhook"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
  DECLARE
    request_id bigint;
    payload jsonb;
  BEGIN
    -- Build the payload
    payload := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', row_to_json(NEW),
      'old_record', NULL
    );

    -- Make HTTP request using pg_net (correct syntax)
    SELECT net.http_post(
      url := 'https://sms-sender-ywaprnbliq-uc.a.run.app/send-sms',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := payload
    ) INTO request_id;

    RETURN NEW;
  END;
  $$;


ALTER FUNCTION "public"."send_sms_webhook"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_credit_cache"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_user_credit_cache"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_actions_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_type" character varying(50) NOT NULL,
    "agent_instance_id" "uuid",
    "action_type" character varying(100) NOT NULL,
    "user_id" "uuid",
    "context_id" "uuid",
    "context_type" character varying(50),
    "model_used" character varying(100),
    "input_tokens" integer,
    "output_tokens" integer,
    "cost_usd" numeric(10,6),
    "latency_ms" integer,
    "input_data" "jsonb",
    "output_data" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agent_actions_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_actions_log" IS 'Comprehensive logging of all agent actions for debugging and cost tracking';



COMMENT ON COLUMN "public"."agent_actions_log"."action_type" IS 'Type of action: "llm_call", "function_execution", "event_published"';



COMMENT ON COLUMN "public"."agent_actions_log"."cost_usd" IS 'Calculated cost for LLM calls based on token usage';



CREATE TABLE IF NOT EXISTS "public"."agent_instances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_type" character varying(50) NOT NULL,
    "user_id" "uuid",
    "config_json" "jsonb",
    "prompt_version" character varying(50),
    "status" character varying(50) DEFAULT 'active'::character varying,
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "terminated_at" timestamp with time zone
);


ALTER TABLE "public"."agent_instances" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_instances" IS 'Tracks agent configuration versions for debugging and A/B testing';



COMMENT ON COLUMN "public"."agent_instances"."config_json" IS 'Model parameters, feature flags, and configuration settings';



COMMENT ON COLUMN "public"."agent_instances"."prompt_version" IS 'Version identifier like "bouncer_v1.2" or "concierge_v2.0"';



CREATE TABLE IF NOT EXISTS "public"."agent_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_type" character varying(100) NOT NULL,
    "agent_type" character varying(50) NOT NULL,
    "user_id" "uuid",
    "context_id" "uuid",
    "context_type" character varying(50),
    "scheduled_for" timestamp with time zone NOT NULL,
    "priority" character varying(20) DEFAULT 'medium'::character varying,
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "retry_count" integer DEFAULT 0,
    "max_retries" integer DEFAULT 3,
    "last_attempted_at" timestamp with time zone,
    "context_json" "jsonb" NOT NULL,
    "result_json" "jsonb",
    "error_log" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" character varying(100),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."agent_tasks" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_tasks" IS 'Task queue for scheduled and event-driven agent work with retry logic';



COMMENT ON COLUMN "public"."agent_tasks"."priority" IS 'Priority level: urgent, high, medium, low for queue ordering';



COMMENT ON COLUMN "public"."agent_tasks"."context_json" IS 'Contains everything needed to process task independently';



CREATE TABLE IF NOT EXISTS "public"."community_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requesting_agent_type" character varying(50) NOT NULL,
    "requesting_user_id" "uuid",
    "context_id" "uuid",
    "context_type" character varying(50),
    "question" "text" NOT NULL,
    "category" character varying(100),
    "expertise_needed" "text"[],
    "target_user_ids" "uuid"[],
    "status" character varying(50) DEFAULT 'open'::character varying,
    "responses_count" integer DEFAULT 0,
    "closed_loop_at" timestamp with time zone,
    "closed_loop_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "requester_context" "text",
    "desired_outcome" character varying,
    "urgency" character varying DEFAULT 'medium'::character varying,
    "request_summary" character varying(100)
);


ALTER TABLE "public"."community_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."community_requests"."requester_context" IS 'Background on why requester is asking - helps experts understand context (e.g., "evaluating vendors for Q1 rollout", "considering market entry")';



COMMENT ON COLUMN "public"."community_requests"."desired_outcome" IS 'What type of help: backchannel | introduction | quick_thoughts | ongoing_advice';



COMMENT ON COLUMN "public"."community_requests"."urgency" IS 'Timeline: low (informational) | medium (weeks) | high (days)';



COMMENT ON COLUMN "public"."community_requests"."request_summary" IS 'Short 3-5 word summary for Concierge to mention tactfully (e.g., "CTV advertising guidance")';



CREATE TABLE IF NOT EXISTS "public"."community_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "response_text" "text" NOT NULL,
    "verbatim_answer" "text" NOT NULL,
    "usefulness_score" integer,
    "impact_description" "text",
    "credits_awarded" integer,
    "credited_at" timestamp with time zone,
    "status" character varying(50) DEFAULT 'provided'::character varying,
    "closed_loop_message" "text",
    "closed_loop_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."community_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connection_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "introducee_user_id" "uuid" NOT NULL,
    "requestor_user_id" "uuid",
    "requestor_prospect_id" "uuid",
    "requestor_name" character varying(255) NOT NULL,
    "requestor_company" character varying(255),
    "requestor_title" character varying(255),
    "requestor_linkedin_url" character varying(500),
    "intro_context" "text" NOT NULL,
    "vouched_by_user_ids" "uuid"[],
    "bounty_credits" integer DEFAULT 0,
    "requestor_credits_spent" integer DEFAULT 0,
    "status" character varying(50) DEFAULT 'open'::character varying,
    "introducee_response" "text",
    "feed_item_id" "uuid",
    "intro_email" character varying(255),
    "intro_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval)
);


ALTER TABLE "public"."connection_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "phone_number" character varying(20) NOT NULL,
    "status" character varying(50) DEFAULT 'active'::character varying,
    "conversation_summary" "text",
    "last_summary_message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_message_at" timestamp with time zone,
    "messages_since_summary" integer DEFAULT 0
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


COMMENT ON TABLE "public"."conversations" IS 'Tracks ongoing conversation threads for context isolation';



COMMENT ON COLUMN "public"."conversations"."phone_number" IS 'Denormalized for webhook lookups (critical path optimization)';



COMMENT ON COLUMN "public"."conversations"."conversation_summary" IS 'LLM-generated summary to prevent context window explosion (summarize every 50 messages)';



COMMENT ON COLUMN "public"."conversations"."messages_since_summary" IS 'Counter for messages since last summarization, triggers summary at 50';



CREATE TABLE IF NOT EXISTS "public"."credit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" character varying(100) NOT NULL,
    "amount" integer NOT NULL,
    "reference_type" character varying(50) NOT NULL,
    "reference_id" "uuid" NOT NULL,
    "idempotency_key" character varying(255) NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "processed" boolean DEFAULT false
);


ALTER TABLE "public"."credit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" character varying(100) NOT NULL,
    "aggregate_id" "uuid",
    "aggregate_type" character varying(50),
    "payload" "jsonb" NOT NULL,
    "metadata" "jsonb",
    "processed" boolean DEFAULT false,
    "version" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" character varying(100)
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON TABLE "public"."events" IS 'Event sourcing table providing complete audit trail and enabling replay';



COMMENT ON COLUMN "public"."events"."aggregate_id" IS 'ID of primary entity this event relates to';



COMMENT ON COLUMN "public"."events"."aggregate_type" IS 'Type of entity (user, intro_opportunity, solution_request)';



COMMENT ON COLUMN "public"."events"."payload" IS 'JSONB payload allows flexible event schemas without migrations';



COMMENT ON COLUMN "public"."events"."processed" IS 'Flag enables idempotent event processing';



CREATE TABLE IF NOT EXISTS "public"."innovators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_name" character varying(255) NOT NULL,
    "solution_description" "text",
    "categories" "text"[],
    "target_customer_profile" "text",
    "video_url" character varying(500),
    "credits_balance" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "warm_intro_bounty" integer DEFAULT 25
);


ALTER TABLE "public"."innovators" OWNER TO "postgres";


COMMENT ON TABLE "public"."innovators" IS 'Companies offering solutions - extended profile for users classified as innovators';



COMMENT ON COLUMN "public"."innovators"."categories" IS 'Array of solution categories for matching';



COMMENT ON COLUMN "public"."innovators"."credits_balance" IS 'Separate credit balance from user credits, used for intro bounties';



CREATE TABLE IF NOT EXISTS "public"."intro_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "offering_user_id" "uuid" NOT NULL,
    "introducee_user_id" "uuid" NOT NULL,
    "prospect_name" character varying(255) NOT NULL,
    "prospect_company" character varying(255),
    "prospect_title" character varying(255),
    "prospect_context" "text",
    "context_type" character varying(50) NOT NULL,
    "context_id" "uuid",
    "status" character varying(50) DEFAULT 'pending_introducee_response'::character varying,
    "introducee_response" "text",
    "connector_confirmation" "text",
    "bounty_credits" integer DEFAULT 0,
    "intro_email" character varying(255),
    "intro_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval)
);


ALTER TABLE "public"."intro_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."intro_opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connector_user_id" "uuid" NOT NULL,
    "innovator_id" "uuid",
    "prospect_id" "uuid",
    "prospect_name" character varying(255) NOT NULL,
    "prospect_company" character varying(255),
    "prospect_title" character varying(255),
    "prospect_linkedin_url" character varying(500),
    "innovator_name" character varying(255),
    "bounty_credits" integer DEFAULT 50,
    "status" character varying(50) DEFAULT 'open'::character varying,
    "connector_response" "text",
    "feed_item_id" "uuid",
    "intro_email" character varying(255),
    "intro_scheduled_at" timestamp with time zone,
    "intro_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."intro_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."linkedin_research_prospects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "company" character varying(255),
    "title" character varying(255),
    "linkedin_url" character varying(500),
    "email" character varying(255),
    "mutual_connections" "jsonb",
    "last_researched_at" timestamp with time zone,
    "users_researching" "uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."linkedin_research_prospects" OWNER TO "postgres";


COMMENT ON TABLE "public"."linkedin_research_prospects" IS 'Individuals not yet on platform, targets for introductions and demand generation';



COMMENT ON COLUMN "public"."linkedin_research_prospects"."mutual_connections" IS 'LinkedIn mutual connections data from research';



COMMENT ON COLUMN "public"."linkedin_research_prospects"."users_researching" IS 'Array of user IDs interested in connecting with this prospect';



CREATE TABLE IF NOT EXISTS "public"."message_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "agent_id" character varying(100) NOT NULL,
    "message_data" "jsonb" NOT NULL,
    "final_message" "text",
    "scheduled_for" timestamp with time zone NOT NULL,
    "priority" character varying(20) DEFAULT 'medium'::character varying,
    "status" character varying(50) DEFAULT 'queued'::character varying,
    "superseded_by_message_id" "uuid",
    "superseded_reason" character varying(100),
    "conversation_context_id" "uuid",
    "requires_fresh_context" boolean DEFAULT false,
    "sent_at" timestamp with time zone,
    "delivered_message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sequence_id" "uuid",
    "sequence_position" integer,
    "sequence_total" integer
);


ALTER TABLE "public"."message_queue" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_queue" IS 'Outbound message queue with rate limiting and priority management';



COMMENT ON COLUMN "public"."message_queue"."message_data" IS 'Structured agent output before rendering to prose';



COMMENT ON COLUMN "public"."message_queue"."final_message" IS 'Concierge-crafted prose message for delivery';



COMMENT ON COLUMN "public"."message_queue"."superseded_by_message_id" IS 'Tracks when messages become stale and are replaced';



COMMENT ON COLUMN "public"."message_queue"."requires_fresh_context" IS 'Flag to recheck message relevance before sending';



COMMENT ON COLUMN "public"."message_queue"."sequence_id" IS 'Groups messages that are part of a multi-message sequence';



COMMENT ON COLUMN "public"."message_queue"."sequence_position" IS '1-indexed position within sequence (1, 2, 3, etc.)';



COMMENT ON COLUMN "public"."message_queue"."sequence_total" IS 'Total number of messages in this sequence';



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" character varying(50) NOT NULL,
    "content" "text" NOT NULL,
    "direction" character varying(20) NOT NULL,
    "twilio_message_sid" character varying(100),
    "status" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."messages" IS 'Individual messages in conversations with delivery tracking';



COMMENT ON COLUMN "public"."messages"."role" IS 'Message sender role: user, concierge, bouncer, innovator, system';



COMMENT ON COLUMN "public"."messages"."direction" IS 'Message direction: inbound (from user) or outbound (to user)';



COMMENT ON COLUMN "public"."messages"."twilio_message_sid" IS 'Twilio message SID for delivery status tracking';



CREATE TABLE IF NOT EXISTS "public"."solution_workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "request_description" "text" NOT NULL,
    "category" character varying(100),
    "current_step" character varying(100) NOT NULL,
    "status" character varying(50) DEFAULT 'in_progress'::character varying,
    "perplexity_results" "jsonb",
    "matched_innovators" "jsonb",
    "community_insights" "jsonb",
    "expert_recommendations" "jsonb",
    "quality_threshold_met" boolean DEFAULT false,
    "last_decision_at" timestamp with time zone,
    "next_action" character varying(100),
    "pending_tasks" "jsonb" DEFAULT '[]'::"jsonb",
    "completed_tasks" "jsonb" DEFAULT '[]'::"jsonb",
    "conversation_log" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."solution_workflows" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_credit_balances" AS
 SELECT "user_id",
    "sum"("amount") AS "balance",
    "count"(*) AS "transaction_count",
    "max"("created_at") AS "last_transaction_at"
   FROM "public"."credit_events"
  WHERE ("processed" = true)
  GROUP BY "user_id";


ALTER VIEW "public"."user_credit_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_message_budget" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "messages_sent" integer DEFAULT 0,
    "last_message_at" timestamp with time zone,
    "daily_limit" integer DEFAULT 5,
    "hourly_limit" integer DEFAULT 2,
    "quiet_hours_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_message_budget" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_message_budget" IS 'Rate limiting to prevent message fatigue with per-user customization';



COMMENT ON COLUMN "public"."user_message_budget"."date" IS 'Date for daily budget tracking';



COMMENT ON COLUMN "public"."user_message_budget"."daily_limit" IS 'Daily message limit, customizable per user (default 5)';



COMMENT ON COLUMN "public"."user_message_budget"."hourly_limit" IS 'Hourly message limit, customizable per user (default 2)';



CREATE TABLE IF NOT EXISTS "public"."user_priorities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "priority_rank" integer NOT NULL,
    "item_type" character varying(50) NOT NULL,
    "item_id" "uuid" NOT NULL,
    "value_score" numeric(5,2),
    "status" character varying(50) DEFAULT 'active'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "presented_at" timestamp with time zone
);


ALTER TABLE "public"."user_priorities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_number" character varying(20) NOT NULL,
    "email" character varying(255),
    "first_name" character varying(100),
    "last_name" character varying(100),
    "company" character varying(255),
    "title" character varying(255),
    "linkedin_url" character varying(500),
    "verified" boolean DEFAULT false,
    "innovator" boolean DEFAULT false,
    "expert_connector" boolean DEFAULT false,
    "expertise" "text"[],
    "poc_agent_id" character varying(50),
    "poc_agent_type" character varying(50),
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "timezone" character varying(50),
    "response_pattern" "jsonb",
    "credit_balance" integer DEFAULT 0,
    "status_level" character varying(50) DEFAULT 'member'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_active_at" timestamp with time zone,
    "referred_by" "uuid",
    "name_dropped" character varying(255),
    "email_verified" boolean DEFAULT false
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'Primary user records for all platform participants';



COMMENT ON COLUMN "public"."users"."verified" IS 'TRUE when user is fully approved into the network and transitioned to Concierge agent. Set manually or by approval process after email_verified is true.';



COMMENT ON COLUMN "public"."users"."expertise" IS 'Array of expertise areas for community request matching';



COMMENT ON COLUMN "public"."users"."poc_agent_id" IS 'ID of primary agent instance that owns this user interface';



COMMENT ON COLUMN "public"."users"."poc_agent_type" IS 'Type of primary agent (bouncer/concierge/innovator) for quick filtering';



COMMENT ON COLUMN "public"."users"."response_pattern" IS 'JSONB store for ML-learned user behavior patterns';



COMMENT ON COLUMN "public"."users"."referred_by" IS 'UUID of the user who referred this user (if referred by existing user)';



COMMENT ON COLUMN "public"."users"."name_dropped" IS 'Raw name string provided by user during onboarding if referrer cannot be matched to existing user';



COMMENT ON COLUMN "public"."users"."email_verified" IS 'TRUE when user has verified their email address via verify-{user_id}@verify.yachtparty.xyz. Does not indicate full network approval (see verified field).';



ALTER TABLE ONLY "public"."agent_actions_log"
    ADD CONSTRAINT "agent_actions_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_instances"
    ADD CONSTRAINT "agent_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_tasks"
    ADD CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_requests"
    ADD CONSTRAINT "community_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_responses"
    ADD CONSTRAINT "community_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_events"
    ADD CONSTRAINT "credit_events_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."credit_events"
    ADD CONSTRAINT "credit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."innovators"
    ADD CONSTRAINT "innovators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."innovators"
    ADD CONSTRAINT "innovators_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."intro_offers"
    ADD CONSTRAINT "intro_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."intro_opportunities"
    ADD CONSTRAINT "intro_opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."linkedin_research_prospects"
    ADD CONSTRAINT "linkedin_research_prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_queue"
    ADD CONSTRAINT "message_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."solution_workflows"
    ADD CONSTRAINT "solution_workflows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_message_budget"
    ADD CONSTRAINT "user_message_budget_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_message_budget"
    ADD CONSTRAINT "user_message_budget_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."user_priorities"
    ADD CONSTRAINT "user_priorities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_priorities"
    ADD CONSTRAINT "user_priorities_user_id_item_type_item_id_key" UNIQUE ("user_id", "item_type", "item_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_budget_user_date" ON "public"."user_message_budget" USING "btree" ("user_id", "date" DESC);



CREATE INDEX "idx_connection_requests_introducee" ON "public"."connection_requests" USING "btree" ("introducee_user_id", "status");



CREATE INDEX "idx_connection_requests_requestor_prospect" ON "public"."connection_requests" USING "btree" ("requestor_prospect_id", "status");



CREATE INDEX "idx_connection_requests_requestor_user" ON "public"."connection_requests" USING "btree" ("requestor_user_id", "status");



CREATE INDEX "idx_connection_requests_status" ON "public"."connection_requests" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_conversations_phone" ON "public"."conversations" USING "btree" ("phone_number");



CREATE INDEX "idx_conversations_status" ON "public"."conversations" USING "btree" ("status", "updated_at");



CREATE INDEX "idx_conversations_user" ON "public"."conversations" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_credits_idempotency" ON "public"."credit_events" USING "btree" ("idempotency_key");



CREATE INDEX "idx_credits_reference" ON "public"."credit_events" USING "btree" ("reference_type", "reference_id");



CREATE INDEX "idx_credits_user" ON "public"."credit_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_events_aggregate" ON "public"."events" USING "btree" ("aggregate_type", "aggregate_id", "created_at" DESC);



CREATE INDEX "idx_events_created" ON "public"."events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_events_processed" ON "public"."events" USING "btree" ("processed", "created_at") WHERE (NOT "processed");



CREATE INDEX "idx_events_type" ON "public"."events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_innovators_active" ON "public"."innovators" USING "btree" ("active", "created_at" DESC);



CREATE INDEX "idx_innovators_categories" ON "public"."innovators" USING "gin" ("categories");



CREATE INDEX "idx_instances_active" ON "public"."agent_instances" USING "btree" ("agent_type", "status") WHERE (("status")::"text" = 'active'::"text");



CREATE INDEX "idx_instances_type_user" ON "public"."agent_instances" USING "btree" ("agent_type", "user_id");



CREATE INDEX "idx_intro_offers_context" ON "public"."intro_offers" USING "btree" ("context_type", "context_id");



CREATE INDEX "idx_intro_offers_introducee_user" ON "public"."intro_offers" USING "btree" ("introducee_user_id", "status");



CREATE INDEX "idx_intro_offers_offering_user" ON "public"."intro_offers" USING "btree" ("offering_user_id", "status");



CREATE INDEX "idx_intro_offers_status" ON "public"."intro_offers" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_intros_connector" ON "public"."intro_opportunities" USING "btree" ("connector_user_id", "status");



CREATE INDEX "idx_intros_innovator" ON "public"."intro_opportunities" USING "btree" ("innovator_id", "status");



CREATE INDEX "idx_intros_status" ON "public"."intro_opportunities" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_log_agent_time" ON "public"."agent_actions_log" USING "btree" ("agent_type", "created_at" DESC);



CREATE INDEX "idx_log_cost" ON "public"."agent_actions_log" USING "btree" ("created_at", "cost_usd") WHERE ("cost_usd" IS NOT NULL);



CREATE INDEX "idx_log_user" ON "public"."agent_actions_log" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_messages_twilio" ON "public"."messages" USING "btree" ("twilio_message_sid");



CREATE INDEX "idx_messages_user" ON "public"."messages" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_priorities_user_active" ON "public"."user_priorities" USING "btree" ("user_id", "status", "priority_rank") WHERE (("status")::"text" = 'active'::"text");



CREATE INDEX "idx_prospects_converted_user" ON "public"."prospects" USING "btree" ("converted_to_user_id") WHERE ("converted_to_user_id" IS NOT NULL);



CREATE INDEX "idx_prospects_email" ON "public"."prospects" USING "btree" ("email") WHERE ("email" IS NOT NULL);



CREATE INDEX "idx_prospects_innovator_id" ON "public"."prospects" USING "btree" ("innovator_id");



CREATE INDEX "idx_prospects_linkedin" ON "public"."prospects" USING "btree" ("linkedin_url") WHERE ("linkedin_url" IS NOT NULL);



CREATE INDEX "idx_prospects_phone" ON "public"."prospects" USING "btree" ("phone_number") WHERE ("phone_number" IS NOT NULL);



CREATE INDEX "idx_prospects_status" ON "public"."prospects" USING "btree" ("status");



CREATE INDEX "idx_prospects_upload_batch" ON "public"."prospects" USING "btree" ("upload_batch_id") WHERE ("upload_batch_id" IS NOT NULL);



CREATE INDEX "idx_queue_due" ON "public"."message_queue" USING "btree" ("status", "scheduled_for", "priority") WHERE (("status")::"text" = 'approved'::"text");



CREATE INDEX "idx_queue_sequence" ON "public"."message_queue" USING "btree" ("sequence_id", "sequence_position") WHERE ("sequence_id" IS NOT NULL);



CREATE INDEX "idx_queue_user_pending" ON "public"."message_queue" USING "btree" ("user_id", "status", "scheduled_for") WHERE (("status")::"text" = ANY ((ARRAY['queued'::character varying, 'approved'::character varying])::"text"[]));



CREATE INDEX "idx_requests_context" ON "public"."community_requests" USING "btree" ("context_type", "context_id");



CREATE INDEX "idx_requests_expertise" ON "public"."community_requests" USING "gin" ("expertise_needed");



CREATE INDEX "idx_requests_status" ON "public"."community_requests" USING "btree" ("status", "created_at");



CREATE INDEX "idx_responses_request" ON "public"."community_responses" USING "btree" ("request_id", "created_at");



CREATE INDEX "idx_responses_status" ON "public"."community_responses" USING "btree" ("status", "created_at");



CREATE INDEX "idx_responses_user" ON "public"."community_responses" USING "btree" ("user_id", "status");



CREATE INDEX "idx_tasks_agent" ON "public"."agent_tasks" USING "btree" ("agent_type", "status", "scheduled_for");



CREATE INDEX "idx_tasks_context" ON "public"."agent_tasks" USING "btree" ("context_type", "context_id");



CREATE INDEX "idx_tasks_due" ON "public"."agent_tasks" USING "btree" ("status", "scheduled_for", "priority") WHERE (("status")::"text" = 'pending'::"text");



COMMENT ON INDEX "public"."idx_tasks_due" IS 'Optimized for FOR UPDATE SKIP LOCKED query pattern to prevent duplicate processing';



CREATE INDEX "idx_tasks_user" ON "public"."agent_tasks" USING "btree" ("user_id", "status");



CREATE INDEX "idx_users_email_verified" ON "public"."users" USING "btree" ("email_verified");



CREATE INDEX "idx_users_phone" ON "public"."users" USING "btree" ("phone_number");



CREATE INDEX "idx_users_poc_agent" ON "public"."users" USING "btree" ("poc_agent_type", "verified");



CREATE INDEX "idx_users_referred_by" ON "public"."users" USING "btree" ("referred_by");



CREATE INDEX "idx_users_verified" ON "public"."users" USING "btree" ("verified");



CREATE INDEX "idx_workflows_status" ON "public"."solution_workflows" USING "btree" ("status", "updated_at");



CREATE INDEX "idx_workflows_user" ON "public"."solution_workflows" USING "btree" ("user_id", "status");



CREATE OR REPLACE TRIGGER "on_credit_event_processed" AFTER INSERT OR UPDATE ON "public"."credit_events" FOR EACH ROW WHEN (("new"."processed" = true)) EXECUTE FUNCTION "public"."update_user_credit_cache"();



CREATE OR REPLACE TRIGGER "on_event_created" AFTER INSERT ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."notify_event"();



CREATE OR REPLACE TRIGGER "on_message_count_check" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."check_conversation_summary"();



CREATE OR REPLACE TRIGGER "on_phone_change" BEFORE UPDATE ON "public"."users" FOR EACH ROW WHEN ((("old"."phone_number")::"text" IS DISTINCT FROM ("new"."phone_number")::"text")) EXECUTE FUNCTION "public"."handle_phone_number_change"();



CREATE OR REPLACE TRIGGER "send_sms_on_message_insert" AFTER INSERT ON "public"."messages" FOR EACH ROW WHEN (((("new"."status")::"text" = 'pending'::"text") AND (("new"."direction")::"text" = 'outbound'::"text"))) EXECUTE FUNCTION "public"."send_sms_webhook"();



CREATE OR REPLACE TRIGGER "update_prospects_updated_at" BEFORE UPDATE ON "public"."prospects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."agent_actions_log"
    ADD CONSTRAINT "agent_actions_log_agent_instance_id_fkey" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id");



ALTER TABLE ONLY "public"."agent_actions_log"
    ADD CONSTRAINT "agent_actions_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."agent_instances"
    ADD CONSTRAINT "agent_instances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."agent_tasks"
    ADD CONSTRAINT "agent_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."community_requests"
    ADD CONSTRAINT "community_requests_requesting_user_id_fkey" FOREIGN KEY ("requesting_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."community_responses"
    ADD CONSTRAINT "community_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."community_requests"("id");



ALTER TABLE ONLY "public"."community_responses"
    ADD CONSTRAINT "community_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_introducee_user_id_fkey" FOREIGN KEY ("introducee_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_requestor_prospect_id_fkey" FOREIGN KEY ("requestor_prospect_id") REFERENCES "public"."prospects"("id");



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_requestor_user_id_fkey" FOREIGN KEY ("requestor_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."credit_events"
    ADD CONSTRAINT "credit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."innovators"
    ADD CONSTRAINT "innovators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."intro_offers"
    ADD CONSTRAINT "intro_offers_introducee_user_id_fkey" FOREIGN KEY ("introducee_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."intro_offers"
    ADD CONSTRAINT "intro_offers_offering_user_id_fkey" FOREIGN KEY ("offering_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."intro_opportunities"
    ADD CONSTRAINT "intro_opportunities_connector_user_id_fkey" FOREIGN KEY ("connector_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."intro_opportunities"
    ADD CONSTRAINT "intro_opportunities_innovator_id_fkey" FOREIGN KEY ("innovator_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."message_queue"
    ADD CONSTRAINT "message_queue_conversation_context_id_fkey" FOREIGN KEY ("conversation_context_id") REFERENCES "public"."conversations"("id");



ALTER TABLE ONLY "public"."message_queue"
    ADD CONSTRAINT "message_queue_delivered_message_id_fkey" FOREIGN KEY ("delivered_message_id") REFERENCES "public"."messages"("id");



ALTER TABLE ONLY "public"."message_queue"
    ADD CONSTRAINT "message_queue_superseded_by_message_id_fkey" FOREIGN KEY ("superseded_by_message_id") REFERENCES "public"."message_queue"("id");



ALTER TABLE ONLY "public"."message_queue"
    ADD CONSTRAINT "message_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_converted_to_user_id_fkey" FOREIGN KEY ("converted_to_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_innovator_id_fkey" FOREIGN KEY ("innovator_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."solution_workflows"
    ADD CONSTRAINT "solution_workflows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_message_budget"
    ADD CONSTRAINT "user_message_budget_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_priorities"
    ADD CONSTRAINT "user_priorities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id");



CREATE POLICY "Allow all operations on events" ON "public"."events" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations on messages" ON "public"."messages" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "innovators_insert_prospects" ON "public"."prospects" FOR INSERT WITH CHECK (("auth"."uid"() = "innovator_id"));



CREATE POLICY "innovators_read_own_prospects" ON "public"."prospects" FOR SELECT USING (("auth"."uid"() = "innovator_id"));



CREATE POLICY "innovators_update_own_prospects" ON "public"."prospects" FOR UPDATE USING (("auth"."uid"() = "innovator_id"));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prospects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_all_prospects" ON "public"."prospects" USING (((("current_setting"('request.jwt.claims'::"text", true))::json ->> 'role'::"text") = 'service_role'::"text"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."check_conversation_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_conversation_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_conversation_summary"() TO "service_role";



GRANT ALL ON TABLE "public"."prospects" TO "anon";
GRANT ALL ON TABLE "public"."prospects" TO "authenticated";
GRANT ALL ON TABLE "public"."prospects" TO "service_role";



GRANT ALL ON FUNCTION "public"."find_matching_prospects"("p_email" "text", "p_phone" "text", "p_linkedin" "text", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_matching_prospects"("p_email" "text", "p_phone" "text", "p_linkedin" "text", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_matching_prospects"("p_email" "text", "p_phone" "text", "p_linkedin" "text", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_phone_number_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_phone_number_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_phone_number_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."send_sms_webhook"() TO "anon";
GRANT ALL ON FUNCTION "public"."send_sms_webhook"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_sms_webhook"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_credit_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_credit_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_credit_cache"() TO "service_role";



GRANT ALL ON TABLE "public"."agent_actions_log" TO "anon";
GRANT ALL ON TABLE "public"."agent_actions_log" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_actions_log" TO "service_role";



GRANT ALL ON TABLE "public"."agent_instances" TO "anon";
GRANT ALL ON TABLE "public"."agent_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_instances" TO "service_role";



GRANT ALL ON TABLE "public"."agent_tasks" TO "anon";
GRANT ALL ON TABLE "public"."agent_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."community_requests" TO "anon";
GRANT ALL ON TABLE "public"."community_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."community_requests" TO "service_role";



GRANT ALL ON TABLE "public"."community_responses" TO "anon";
GRANT ALL ON TABLE "public"."community_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."community_responses" TO "service_role";



GRANT ALL ON TABLE "public"."connection_requests" TO "anon";
GRANT ALL ON TABLE "public"."connection_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."connection_requests" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."credit_events" TO "anon";
GRANT ALL ON TABLE "public"."credit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_events" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."innovators" TO "anon";
GRANT ALL ON TABLE "public"."innovators" TO "authenticated";
GRANT ALL ON TABLE "public"."innovators" TO "service_role";



GRANT ALL ON TABLE "public"."intro_offers" TO "anon";
GRANT ALL ON TABLE "public"."intro_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."intro_offers" TO "service_role";



GRANT ALL ON TABLE "public"."intro_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."intro_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."intro_opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."linkedin_research_prospects" TO "anon";
GRANT ALL ON TABLE "public"."linkedin_research_prospects" TO "authenticated";
GRANT ALL ON TABLE "public"."linkedin_research_prospects" TO "service_role";



GRANT ALL ON TABLE "public"."message_queue" TO "anon";
GRANT ALL ON TABLE "public"."message_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."message_queue" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."solution_workflows" TO "anon";
GRANT ALL ON TABLE "public"."solution_workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."solution_workflows" TO "service_role";



GRANT ALL ON TABLE "public"."user_credit_balances" TO "anon";
GRANT ALL ON TABLE "public"."user_credit_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."user_credit_balances" TO "service_role";



GRANT ALL ON TABLE "public"."user_message_budget" TO "anon";
GRANT ALL ON TABLE "public"."user_message_budget" TO "authenticated";
GRANT ALL ON TABLE "public"."user_message_budget" TO "service_role";



GRANT ALL ON TABLE "public"."user_priorities" TO "anon";
GRANT ALL ON TABLE "public"."user_priorities" TO "authenticated";
GRANT ALL ON TABLE "public"."user_priorities" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
