/**
 * Task Handler Index
 *
 * Exports all task handlers and provides handler registry.
 */

import { handleResearchSolution } from './research';
import { handleScheduleFollowup } from './schedule';
import { handleUpdateUserProfile } from './profile';
import { handleReengagementCheck } from './reengagement';
import {
  handleCommunityRequestAvailable,
  handleProcessCommunityResponse,
  handleCommunityResponseAvailable,
  handleNotifyExpertOfImpact,
} from './community';
import type { TaskType } from '@yachtparty/shared';
import type { TaskHandler } from '../types';

/**
 * Registry of task handlers by task type
 */
export const taskHandlers: Record<TaskType, TaskHandler> = {
  research_solution: handleResearchSolution,
  schedule_followup: handleScheduleFollowup,
  update_user_profile: handleUpdateUserProfile,
  re_engagement_check: handleReengagementCheck,

  // Community request handlers
  community_request_available: handleCommunityRequestAvailable,
  process_community_response: handleProcessCommunityResponse,
  community_response_available: handleCommunityResponseAvailable,
  notify_expert_of_impact: handleNotifyExpertOfImpact,

  // Placeholder handlers for task types not yet implemented
  process_community_request: async (task) => {
    console.log(`[${task.id}] Handler not implemented: process_community_request`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  notify_user_of_priorities: async (task) => {
    console.log(`[${task.id}] Handler not implemented: notify_user_of_priorities`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  solution_workflow_timeout: async (task) => {
    console.log(`[${task.id}] Handler not implemented: solution_workflow_timeout`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  create_conversation_summary: async (task) => {
    console.log(`[${task.id}] Handler not implemented: create_conversation_summary`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  intro_followup_check: async (task) => {
    console.log(`[${task.id}] Handler not implemented: intro_followup_check`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  send_introduction: async (task) => {
    console.log(`[${task.id}] Handler not implemented: send_introduction`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  verify_user: async (task) => {
    console.log(`[${task.id}] Handler not implemented: verify_user`);
    return { success: false, error: 'Handler not implemented', shouldRetry: false };
  },
  verify_linkedin_connection: async (task) => {
    console.log(`[${task.id}] Handler not implemented: verify_linkedin_connection (Social Butterfly Agent)`);
    return { success: false, error: 'Handler not implemented - Social Butterfly Agent', shouldRetry: false };
  },
};

export {
  handleResearchSolution,
  handleScheduleFollowup,
  handleUpdateUserProfile,
  handleReengagementCheck,
};
