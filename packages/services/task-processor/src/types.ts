/**
 * Task Processor Type Definitions
 *
 * TypeScript interfaces for task processing service.
 * Extends shared types with service-specific structures.
 *
 * @module task-processor/types
 */

import type { AgentTask, AgentType, Priority, TaskStatus, TaskType } from '@yachtparty/shared';

// ============================================================================
// Task Processing Types
// ============================================================================

/**
 * Task from database with all fields
 */
export interface Task {
  id: string;
  task_type: TaskType;
  agent_type: AgentType;
  user_id: string | null;
  context_id: string | null;
  context_type: string | null;
  scheduled_for: Date | string;
  priority: Priority;
  status: TaskStatus;
  retry_count: number;
  max_retries: number;
  last_attempted_at: Date | string | null;
  context_json: Record<string, any>;
  result_json: Record<string, any> | null;
  error_log: string | null;
  created_at: Date | string;
  created_by: string | null;
  completed_at: Date | string | null;
}

/**
 * Task processing result
 */
export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  shouldRetry?: boolean;
}

/**
 * Handler function signature
 */
export type TaskHandler = (task: Task) => Promise<TaskResult>;

/**
 * Processing statistics
 */
export interface ProcessingStats {
  tasksProcessed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  lastProcessedAt: Date | null;
}

/**
 * Retry calculation result
 */
export interface RetryInfo {
  nextRetryAt: Date;
  backoffMs: number;
}

// ============================================================================
// Task-Specific Context Types
// ============================================================================

/**
 * Context for re-engagement check tasks
 */
export interface ReengagementContext {
  current_step: string;
  missing_fields: string[];
  last_interaction_at: string;
  attemptCount: number;
}

/**
 * Context for solution research tasks
 */
export interface ResearchContext {
  description: string;
  category?: string;
  urgency?: 'low' | 'medium' | 'high';
  conversationId?: string;
}

/**
 * Context for schedule followup tasks
 */
export interface FollowupContext {
  reason: string;
  originalMessageId?: string;
  conversationId?: string;
}

/**
 * Context for profile update tasks
 */
export interface ProfileUpdateContext {
  field: string;
  value: any;
  source?: string;
}

/**
 * Context for introduction tasks
 */
export interface IntroductionContext {
  introOpportunityId: string;
  connectorUserId: string;
  prospectName: string;
  innovatorName?: string;
}

/**
 * Context for verification tasks
 */
export interface VerificationContext {
  email?: string;
  linkedinUrl?: string;
  verificationType: 'email' | 'linkedin' | 'manual';
}
