/**
 * Test Database Utilities
 *
 * Provides utilities for working with test databases in E2E simulation tests.
 * Enables isolated test runs with clean database state and proper cleanup.
 *
 * Usage:
 *   const dbClient = await createTestDbClient();
 *   await seedTestData(dbClient, { users: [testUser] });
 *   // ... run test ...
 *   await cleanTestData(dbClient, testUser.id);
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  User,
  Conversation,
  Message,
  Event,
  AgentTask,
} from '@yachtparty/shared/types/database';

/**
 * Creates a test database client
 *
 * By default, uses the same database as production but with a test-specific schema
 * or prefix to isolate test data. For full isolation, set TEST_DATABASE_URL.
 *
 * Environment Variables:
 * - TEST_DATABASE_URL: Full test database URL (optional, uses SUPABASE_URL if not set)
 * - TEST_SUPABASE_ANON_KEY: Test database anon key (optional, uses SUPABASE_ANON_KEY if not set)
 * - SUPABASE_SERVICE_KEY: Service role key for cleanup operations
 */
export function createTestDbClient(): SupabaseClient {
  const supabaseUrl = process.env.TEST_DATABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Always use service key for tests

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing test database configuration. Set TEST_DATABASE_URL and SUPABASE_SERVICE_KEY environment variables.'
    );
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'apikey': supabaseKey,
      },
    },
  });

  return client;
}

/**
 * Test data to seed
 */
export interface TestDataSeed {
  users?: User[];
  conversations?: Conversation[];
  messages?: Message[];
  events?: Event[];
  agentTasks?: AgentTask[];
}

/**
 * Seeds the test database with fixture data
 *
 * Inserts test data in the correct order to satisfy foreign key constraints:
 * 1. Users
 * 2. Conversations
 * 3. Messages, Events, Agent Tasks
 *
 * @param dbClient - Test database client
 * @param seed - Test data to insert
 * @returns IDs of inserted records for later cleanup
 */
export async function seedTestData(
  dbClient: SupabaseClient,
  seed: TestDataSeed
): Promise<{
  userIds: string[];
  conversationIds: string[];
  messageIds: string[];
  eventIds: string[];
  taskIds: string[];
}> {
  const result = {
    userIds: [] as string[],
    conversationIds: [] as string[],
    messageIds: [] as string[],
    eventIds: [] as string[],
    taskIds: [] as string[],
  };

  try {
    // Insert users first (no dependencies)
    if (seed.users && seed.users.length > 0) {
      const { data: users, error: usersError } = await dbClient
        .from('users')
        .insert(seed.users)
        .select('id');

      if (usersError) {
        throw new Error(`Failed to seed users: ${usersError.message}`);
      }

      result.userIds = users?.map((u) => u.id) || [];
    }

    // Insert conversations (depends on users)
    if (seed.conversations && seed.conversations.length > 0) {
      const { data: conversations, error: conversationsError } = await dbClient
        .from('conversations')
        .insert(seed.conversations)
        .select('id');

      if (conversationsError) {
        throw new Error(`Failed to seed conversations: ${conversationsError.message}`);
      }

      result.conversationIds = conversations?.map((c) => c.id) || [];
    }

    // Insert messages (depends on conversations and users)
    if (seed.messages && seed.messages.length > 0) {
      const { data: messages, error: messagesError } = await dbClient
        .from('messages')
        .insert(seed.messages)
        .select('id');

      if (messagesError) {
        throw new Error(`Failed to seed messages: ${messagesError.message}`);
      }

      result.messageIds = messages?.map((m) => m.id) || [];
    }

    // Insert events (independent)
    if (seed.events && seed.events.length > 0) {
      const { data: events, error: eventsError } = await dbClient
        .from('events')
        .insert(seed.events)
        .select('id');

      if (eventsError) {
        throw new Error(`Failed to seed events: ${eventsError.message}`);
      }

      result.eventIds = events?.map((e) => e.id) || [];
    }

    // Insert agent tasks (may depend on users)
    if (seed.agentTasks && seed.agentTasks.length > 0) {
      const { data: tasks, error: tasksError } = await dbClient
        .from('agent_tasks')
        .insert(seed.agentTasks)
        .select('id');

      if (tasksError) {
        throw new Error(`Failed to seed agent tasks: ${tasksError.message}`);
      }

      result.taskIds = tasks?.map((t) => t.id) || [];
    }

    return result;
  } catch (error) {
    // If seeding fails, try to clean up what was inserted
    await cleanTestDataByIds(dbClient, result);
    throw error;
  }
}

/**
 * Cleans up test data for a specific user
 *
 * Deletes all data associated with a test user, in the correct order
 * to satisfy foreign key constraints:
 * 1. Messages
 * 2. Conversations
 * 3. Events, Agent Tasks, User Priorities, etc.
 * 4. User
 *
 * @param dbClient - Test database client
 * @param userId - ID of the user to clean up
 */
export async function cleanTestData(
  dbClient: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    // Delete in reverse dependency order

    // 1. Delete messages (depends on conversations)
    await dbClient
      .from('messages')
      .delete()
      .eq('user_id', userId);

    // 2. Delete conversations (depends on user)
    await dbClient
      .from('conversations')
      .delete()
      .eq('user_id', userId);

    // 3. Delete events (may reference user)
    await dbClient
      .from('events')
      .delete()
      .or(`aggregate_id.eq.${userId},created_by.eq.test-agent-${userId}`);

    // 4. Delete agent tasks
    await dbClient
      .from('agent_tasks')
      .delete()
      .eq('user_id', userId);

    // 5. Delete user priorities
    await dbClient
      .from('user_priorities')
      .delete()
      .eq('user_id', userId);

    // 6. Delete solution workflows
    await dbClient
      .from('solution_workflows')
      .delete()
      .eq('user_id', userId);

    // 7. Delete agent actions log
    await dbClient
      .from('agent_actions_log')
      .delete()
      .eq('user_id', userId);

    // 8. Delete message queue
    await dbClient
      .from('message_queue')
      .delete()
      .eq('user_id', userId);

    // 9. Finally, delete the user
    await dbClient
      .from('users')
      .delete()
      .eq('id', userId);

  } catch (error) {
    console.error(`Failed to clean test data for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Cleans up test data by specific IDs
 *
 * Useful for cleanup after seeding fails partway through.
 * Deletes in reverse dependency order.
 *
 * @param dbClient - Test database client
 * @param ids - IDs of records to delete
 */
export async function cleanTestDataByIds(
  dbClient: SupabaseClient,
  ids: {
    userIds?: string[];
    conversationIds?: string[];
    messageIds?: string[];
    eventIds?: string[];
    taskIds?: string[];
  }
): Promise<void> {
  try {
    // Delete in reverse dependency order

    if (ids.messageIds && ids.messageIds.length > 0) {
      await dbClient
        .from('messages')
        .delete()
        .in('id', ids.messageIds);
    }

    if (ids.conversationIds && ids.conversationIds.length > 0) {
      await dbClient
        .from('conversations')
        .delete()
        .in('id', ids.conversationIds);
    }

    if (ids.eventIds && ids.eventIds.length > 0) {
      await dbClient
        .from('events')
        .delete()
        .in('id', ids.eventIds);
    }

    if (ids.taskIds && ids.taskIds.length > 0) {
      await dbClient
        .from('agent_tasks')
        .delete()
        .in('id', ids.taskIds);
    }

    if (ids.userIds && ids.userIds.length > 0) {
      // Clean up all user-related data
      for (const userId of ids.userIds) {
        await cleanTestData(dbClient, userId);
      }
    }

  } catch (error) {
    console.error('Failed to clean test data by IDs:', error);
    // Don't throw - cleanup is best effort
  }
}

/**
 * Cleans up all test data matching a pattern
 *
 * WARNING: This is a destructive operation! Only use in test environments.
 * Deletes all records where IDs match the test pattern (e.g., "test-*").
 *
 * @param dbClient - Test database client
 * @param idPattern - Pattern to match test IDs (default: "test-%")
 */
export async function cleanAllTestData(
  dbClient: SupabaseClient,
  idPattern: string = 'test-%'
): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot clean all test data in production environment!');
  }

  console.warn(`Cleaning all test data matching pattern: ${idPattern}`);

  try {
    // Delete in reverse dependency order
    await dbClient.from('messages').delete().ilike('id', idPattern);
    await dbClient.from('conversations').delete().ilike('id', idPattern);
    await dbClient.from('events').delete().ilike('id', idPattern);
    await dbClient.from('agent_tasks').delete().ilike('id', idPattern);
    await dbClient.from('user_priorities').delete().ilike('id', idPattern);
    await dbClient.from('solution_workflows').delete().ilike('id', idPattern);
    await dbClient.from('agent_actions_log').delete().ilike('user_id', idPattern);
    await dbClient.from('message_queue').delete().ilike('id', idPattern);
    await dbClient.from('users').delete().ilike('id', idPattern);

    console.log(`Successfully cleaned all test data matching: ${idPattern}`);
  } catch (error) {
    console.error('Failed to clean all test data:', error);
    throw error;
  }
}

/**
 * Retrieves events published during a test
 *
 * Useful for verifying that agents published the correct events.
 *
 * @param dbClient - Test database client
 * @param aggregateId - ID to filter events by (typically user ID)
 * @param eventTypes - Optional array of event types to filter by
 * @param since - Optional timestamp to get events since
 * @returns Array of events
 */
export async function getEventsPublished(
  dbClient: SupabaseClient,
  aggregateId: string,
  eventTypes?: string[],
  since?: Date
): Promise<Event[]> {
  let query = dbClient
    .from('events')
    .select('*')
    .eq('aggregate_id', aggregateId)
    .order('created_at', { ascending: true });

  if (eventTypes && eventTypes.length > 0) {
    query = query.in('event_type', eventTypes);
  }

  if (since) {
    query = query.gte('created_at', since.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to retrieve events: ${error.message}`);
  }

  return (data || []) as Event[];
}

/**
 * Retrieves agent tasks created during a test
 *
 * Useful for verifying that agents scheduled the correct follow-up tasks.
 *
 * @param dbClient - Test database client
 * @param userId - User ID to filter tasks by
 * @param taskTypes - Optional array of task types to filter by
 * @param since - Optional timestamp to get tasks since
 * @returns Array of agent tasks
 */
export async function getAgentTasks(
  dbClient: SupabaseClient,
  userId: string,
  taskTypes?: string[],
  since?: Date
): Promise<AgentTask[]> {
  let query = dbClient
    .from('agent_tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (taskTypes && taskTypes.length > 0) {
    query = query.in('task_type', taskTypes);
  }

  if (since) {
    query = query.gte('created_at', since.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to retrieve agent tasks: ${error.message}`);
  }

  return (data || []) as AgentTask[];
}

/**
 * Resets the test database by deleting ALL test data
 *
 * USE WITH EXTREME CAUTION: This deletes ALL data in the test database.
 * Only use this for initial test suite setup, never in production.
 *
 * IMPORTANT: Individual tests should clean up their own data using
 * runner.cleanup(userId) instead of resetting the entire database.
 */
export async function resetTestDatabase(): Promise<void> {
  // CRITICAL: Multiple safeguards to prevent production usage

  // 1. Check NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Cannot reset database in production environment!');
  }

  // 2. Require TEST_DATABASE_URL to be explicitly set
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'FATAL: TEST_DATABASE_URL must be explicitly set to use resetTestDatabase(). ' +
      'This prevents accidental production database resets.'
    );
  }

  // 3. Verify URL contains test database identifier
  const isTestDb = testUrl.includes('test') || testUrl.includes('igxwsyvmffcvxbqmrwpc');
  if (!isTestDb) {
    throw new Error(
      'FATAL: Database URL does not appear to be a test database. ' +
      'TEST_DATABASE_URL must contain "test" or test project reference. ' +
      `Got: ${testUrl.substring(0, 50)}...`
    );
  }

  // 4. Check for production database reference
  const prodRef = 'wdjmhpmwiunkltkodbqh'; // Production project reference
  if (testUrl.includes(prodRef)) {
    throw new Error(
      'FATAL: TEST_DATABASE_URL contains production database reference! ' +
      'Cannot reset production database.'
    );
  }

  const dbClient = await createTestDbClient();

  console.log('⚠️  RESETTING ENTIRE TEST DATABASE...');
  console.log(`Database: ${testUrl.substring(0, 50)}...`);

  try {
    // Delete in reverse dependency order
    await dbClient.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('agent_tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('user_priorities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('solution_workflows').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('agent_actions_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('message_queue').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await dbClient.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log('✅ Test database reset complete');
  } catch (error) {
    console.error('Failed to reset test database:', error);
    throw error;
  }
}
