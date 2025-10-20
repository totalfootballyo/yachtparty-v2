/**
 * Account Manager Agent - Type Definitions
 *
 * This agent tracks user priorities through conversation.
 * It maintains three types of priorities: goals, challenges, and opportunities.
 *
 * @module account-manager/types
 */

import type { Message } from '@yachtparty/shared';

/**
 * Priority types that Account Manager tracks
 */
export type PriorityType = 'goal' | 'challenge' | 'opportunity';

/**
 * Priority status lifecycle
 */
export type PriorityStatus = 'active' | 'archived' | 'achieved' | 'expired';

/**
 * User priority record (maps to user_priorities table but with semantic meaning)
 */
export interface UserPriority {
  id: string;
  user_id: string;
  priority_type: PriorityType;
  content: string;
  status: PriorityStatus;
  created_at: string;
  updated_at?: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Actions the Account Manager can take
 */
export type AccountManagerAction =
  | {
      type: 'update_priority';
      params: {
        priority_type: PriorityType;
        content: string;
        status: PriorityStatus;
        metadata?: Record<string, unknown>;
      };
      reason: string;
    }
  | {
      type: 'archive_priority';
      params: {
        priority_id: string;
        reason: string;
      };
      reason: string;
    }
  | {
      type: 'schedule_check_in';
      params: {
        days_from_now: number;
        reason: string;
      };
      reason: string;
    }
  | {
      type: 'provide_context';
      params: {
        relevant_priorities: string[];
        reason: string;
      };
      reason: string;
    };

/**
 * Response from Account Manager agent
 */
export interface AccountManagerResponse {
  immediateReply: false; // Account Manager never replies directly to users
  actions: AccountManagerAction[];
  events?: Array<{
    event_type: string;
    aggregate_id: string;
    aggregate_type: string;
    payload: any;
    created_by: string;
  }>;
  reasoning?: string;
}

/**
 * Context for Account Manager invocation
 */
export interface AccountManagerContext {
  trigger:
    | 'scheduled_review' // Every 2 weeks
    | 'explicit_mention' // User mentioned goals/challenges
    | 'initial_setup' // After 3rd conversation
    | 'context_request'; // Another agent needs context
  recentMessages?: Message[];
  conversationCount?: number;
}

/**
 * Extracted priorities from conversation
 */
export interface ExtractedPriorities {
  goals: string[];
  challenges: string[];
  opportunities: string[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

/**
 * Priority update decision from LLM
 */
export interface PriorityUpdateDecision {
  action: 'ADD' | 'UPDATE' | 'ARCHIVE' | 'SCHEDULE_CHECK_IN' | 'NO_ACTION';
  priority_type?: PriorityType;
  content?: string;
  priority_id?: string;
  reason: string;
  confidence: number; // 0-100
}

/**
 * Formatted priorities for prompt
 */
export interface FormattedPriorities {
  goals: Array<{ id: string; content: string; created_at: string }>;
  challenges: Array<{ id: string; content: string; created_at: string }>;
  opportunities: Array<{ id: string; content: string; created_at: string }>;
}
