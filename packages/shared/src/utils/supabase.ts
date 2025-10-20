/**
 * Supabase Client Utilities
 *
 * Provides Supabase client creation and database helper functions
 * for the Yachtparty shared package.
 *
 * All functions handle errors gracefully and return typed results.
 *
 * @module utils/supabase
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { User, Conversation, Message, UserPriority } from '../types/database';

/**
 * Creates an authenticated Supabase client using environment variables.
 *
 * Requires the following environment variables:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_ANON_KEY: Your Supabase anonymous key
 *
 * @returns Authenticated Supabase client
 * @throws Error if required environment variables are missing
 *
 * @example
 * ```typescript
 * const supabase = createSupabaseClient();
 * const { data, error } = await supabase.from('users').select('*');
 * ```
 */
export function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY must be set'
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Creates a Supabase client with service role key for admin operations.
 *
 * Service role clients bypass Row Level Security (RLS) policies.
 * Use with caution and only in trusted server environments.
 *
 * Requires the following environment variables:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_KEY: Your Supabase service role key
 *
 * @returns Supabase client with service role privileges
 * @throws Error if required environment variables are missing
 *
 * @example
 * ```typescript
 * const supabase = createServiceClient();
 * // Can bypass RLS policies
 * const { data, error } = await supabase.from('users').select('*');
 * ```
 */
export function createServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * Retrieves a user by their ID.
 *
 * @param userId - The unique identifier of the user
 * @returns User record or null if not found
 * @throws Error if database query fails
 *
 * @example
 * ```typescript
 * const user = await getUser('123e4567-e89b-12d3-a456-426614174000');
 * if (user) {
 *   console.log(user.first_name, user.email);
 * }
 * ```
 */
export async function getUser(userId: string): Promise<User | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    throw new Error(`Failed to fetch user ${userId}: ${error.message}`);
  }

  return data as User;
}

/**
 * Retrieves a conversation by its ID.
 *
 * @param conversationId - The unique identifier of the conversation
 * @returns Conversation record or null if not found
 * @throws Error if database query fails
 *
 * @example
 * ```typescript
 * const conversation = await getConversation('conv_123');
 * if (conversation) {
 *   console.log(`Status: ${conversation.status}`);
 * }
 * ```
 */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    throw new Error(`Failed to fetch conversation ${conversationId}: ${error.message}`);
  }

  return data as Conversation;
}

/**
 * Retrieves recent messages from a conversation.
 *
 * Messages are returned in descending order by creation time (newest first).
 *
 * @param conversationId - The unique identifier of the conversation
 * @param limit - Maximum number of messages to retrieve (default: 20)
 * @returns Array of message records (may be empty)
 * @throws Error if database query fails
 *
 * @example
 * ```typescript
 * // Get last 20 messages
 * const messages = await getRecentMessages('conv_123');
 *
 * // Get last 50 messages
 * const moreMessages = await getRecentMessages('conv_123', 50);
 * ```
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 20
): Promise<Message[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Failed to fetch messages for conversation ${conversationId}: ${error.message}`
    );
  }

  return (data as Message[]) || [];
}

/**
 * Retrieves user priorities, ordered by rank.
 *
 * Returns active priorities ranked from highest (1) to lowest.
 * Used by Concierge to understand what opportunities to present to users.
 *
 * @param userId - The unique identifier of the user
 * @param limit - Maximum number of priorities to retrieve (default: 10)
 * @returns Array of user priority records (may be empty)
 * @throws Error if database query fails
 *
 * @example
 * ```typescript
 * // Get top 10 priorities
 * const priorities = await getUserPriorities('user_123');
 *
 * // Get top 5 priorities
 * const topPriorities = await getUserPriorities('user_123', 5);
 *
 * // Process priorities
 * for (const priority of priorities) {
 *   console.log(`Rank ${priority.priority_rank}: ${priority.item_type}`);
 * }
 * ```
 */
export async function getUserPriorities(
  userId: string,
  limit: number = 10
): Promise<UserPriority[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('user_priorities')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('priority_rank', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch priorities for user ${userId}: ${error.message}`);
  }

  return (data as UserPriority[]) || [];
}
