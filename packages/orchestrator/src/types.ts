/**
 * Shared types for Message Orchestrator
 */

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export type MessageStatus = 'queued' | 'approved' | 'sent' | 'superseded' | 'cancelled';

export type Direction = 'inbound' | 'outbound';

export interface MessageData {
  type: string;
  [key: string]: any;
}

export interface ResponsePattern {
  best_hours?: number[];
  avg_response_time_minutes?: number;
  preferred_days?: string[];
  engagement_score?: number;
}

export interface UserProfile {
  id: string;
  phone_number: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  timezone?: string;
  response_pattern?: ResponsePattern;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

export interface ConversationRecord {
  id: string;
  user_id: string;
  phone_number: string;
  status: string;
  conversation_summary?: string;
  last_message_at?: Date;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  direction: Direction;
  twilio_message_sid?: string;
  status: string;
  created_at: Date;
  sent_at?: Date;
  delivered_at?: Date;
}

export interface AgentTask {
  id: string;
  task_type: string;
  agent_type: string;
  user_id?: string;
  scheduled_for: Date;
  priority: Priority;
  status: string;
  context_json: any;
}

export interface AgentActionLog {
  id: string;
  agent_type: string;
  action_type: string;
  model_used?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  input_data?: any;
  output_data?: any;
  error?: string;
  created_at: Date;
}
