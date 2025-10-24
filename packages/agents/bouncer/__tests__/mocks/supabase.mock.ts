/**
 * Supabase Mock Utilities for Bouncer Agent
 *
 * Provides utilities to mock Supabase database calls for testing.
 * Adapted for Bouncer-specific needs (onboarding flow, user verification, etc.)
 */

import type { User, Message, Conversation } from '@yachtparty/shared';

/**
 * Create a mock Supabase client with in-memory data
 */
export function createMockSupabaseClient(data: {
  users?: User[];
  messages?: Message[];
  conversations?: Conversation[];
  events?: any[];
  tasks?: any[];
  agentActionsLog?: any[];
  introOpportunities?: any[];
  linkedinResearchProspects?: any[];
}) {
  const mockData = {
    users: data.users || [],
    messages: data.messages || [],
    conversations: data.conversations || [],
    events: data.events || [],
    tasks: data.tasks || [],
    agentActionsLog: data.agentActionsLog || [],
    introOpportunities: data.introOpportunities || [],
    linkedinResearchProspects: data.linkedinResearchProspects || [],
  };

  // Track inserted data
  const insertedData: Record<string, any[]> = {
    events: [],
    tasks: [],
    agentActionsLog: [],
    agent_actions_log: [], // Handle both naming conventions
    agent_tasks: [],
    intro_opportunities: [],
    linkedin_research_prospects: [],
  };

  // Track updated data (for user profile updates)
  const updatedData: Record<string, any[]> = {
    users: [],
  };

  const mockFrom = (table: string) => {
    const queryBuilder: any = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn(),
      gte: jest.fn().mockReturnThis(),
      contains: jest.fn().mockReturnThis(),
    };

    // Implement select query
    queryBuilder.select.mockImplementation((columns?: string) => {
      queryBuilder._selectedColumns = columns;
      return queryBuilder;
    });

    // Implement eq filter
    queryBuilder.eq.mockImplementation((column: string, value: any) => {
      queryBuilder._filters = queryBuilder._filters || [];
      queryBuilder._filters.push({ type: 'eq', column, value });
      return queryBuilder;
    });

    // Implement ilike filter (case-insensitive like)
    queryBuilder.ilike.mockImplementation((column: string, pattern: string) => {
      queryBuilder._filters = queryBuilder._filters || [];
      queryBuilder._filters.push({ type: 'ilike', column, pattern });
      return queryBuilder;
    });

    // Implement in filter
    queryBuilder.in.mockImplementation((column: string, values: any[]) => {
      queryBuilder._filters = queryBuilder._filters || [];
      queryBuilder._filters.push({ type: 'in', column, values });
      return queryBuilder;
    });

    // Implement gte filter
    queryBuilder.gte.mockImplementation((column: string, value: any) => {
      queryBuilder._filters = queryBuilder._filters || [];
      queryBuilder._filters.push({ type: 'gte', column, value });
      return queryBuilder;
    });

    // Implement contains filter (for JSONB array columns)
    queryBuilder.contains.mockImplementation((column: string, values: any[]) => {
      queryBuilder._filters = queryBuilder._filters || [];
      queryBuilder._filters.push({ type: 'contains', column, values });
      return queryBuilder;
    });

    // Implement order
    queryBuilder.order.mockImplementation((column: string, opts?: { ascending: boolean }) => {
      queryBuilder._orderBy = { column, ascending: opts?.ascending ?? true };
      return queryBuilder;
    });

    // Implement limit
    queryBuilder.limit.mockImplementation((count: number) => {
      queryBuilder._limit = count;
      return queryBuilder;
    });

    // Implement single (returns first result)
    queryBuilder.single.mockImplementation(() => {
      const results = applyFilters(table, mockData, queryBuilder._filters);
      const ordered = applyOrder(results, queryBuilder._orderBy);
      const limited = applyLimit(ordered, 1);

      return Promise.resolve({
        data: limited[0] || null,
        error: limited[0] ? null : { message: 'No data found' },
      });
    });

    // Implement then (for select queries without single)
    queryBuilder.then = (resolve: any) => {
      const results = applyFilters(table, mockData, queryBuilder._filters);
      const ordered = applyOrder(results, queryBuilder._orderBy);
      const limited = applyLimit(ordered, queryBuilder._limit);

      return Promise.resolve(
        resolve({
          data: limited,
          error: null,
        })
      );
    };

    // Implement insert
    queryBuilder.insert.mockImplementation((record: any) => {
      queryBuilder._insertData = record;

      // Track inserted data for verification
      const normalizedTable = normalizeTableName(table);
      if (!insertedData[normalizedTable]) {
        insertedData[normalizedTable] = [];
      }
      insertedData[normalizedTable].push(record);

      // For insert, we need to handle select() and single() chaining
      const insertBuilder: any = {
        select: jest.fn().mockReturnThis(),
        single: jest.fn(),
      };

      insertBuilder.single.mockImplementation(() => {
        return Promise.resolve({
          data: { ...record, id: `mock-id-${Date.now()}` },
          error: null,
        });
      });

      insertBuilder.then = (resolve: any) => {
        return Promise.resolve(
          resolve({
            data: null,
            error: null,
          })
        );
      };

      return insertBuilder;
    });

    // Implement update
    queryBuilder.update.mockImplementation((updates: any) => {
      queryBuilder._updateData = updates;

      const updateBuilder: any = {
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn(),
        then: (resolve: any) => {
          // Track updated data
          const normalizedTable = normalizeTableName(table);
          if (!updatedData[normalizedTable]) {
            updatedData[normalizedTable] = [];
          }
          updatedData[normalizedTable].push({
            filters: queryBuilder._filters,
            updates,
          });

          return Promise.resolve(
            resolve({
              data: null,
              error: null,
            })
          );
        },
      };

      updateBuilder.eq.mockImplementation((column: string, value: any) => {
        queryBuilder._filters = queryBuilder._filters || [];
        queryBuilder._filters.push({ type: 'eq', column, value });
        return updateBuilder;
      });

      // For update().eq().select().single() chain
      updateBuilder.single.mockImplementation(() => {
        // Find and update the matching record
        const results = applyFilters(table, mockData, queryBuilder._filters);
        if (results.length > 0) {
          const updatedRecord = { ...results[0], ...updates };
          return Promise.resolve({
            data: updatedRecord,
            error: null,
          });
        }

        return Promise.resolve({
          data: null,
          error: { message: 'No data found to update' },
        });
      });

      return updateBuilder;
    });

    return queryBuilder;
  };

  const client = {
    from: mockFrom,
    _getInsertedData: (table: string) => insertedData[normalizeTableName(table)] || [],
    _getUpdatedData: (table: string) => updatedData[normalizeTableName(table)] || [],
  };

  return client as any;
}

/**
 * Normalize table name (handle snake_case vs camelCase)
 */
function normalizeTableName(table: string): string {
  const normalizations: Record<string, string> = {
    agent_actions_log: 'agentActionsLog',
    agent_tasks: 'tasks',
    intro_opportunities: 'introOpportunities',
    linkedin_research_prospects: 'linkedinResearchProspects',
  };

  return normalizations[table] || table;
}

/**
 * Apply filters to mock data
 */
function applyFilters(table: string, mockData: any, filters?: any[]): any[] {
  const normalizedTable = normalizeTableName(table);
  let results = [...(mockData[normalizedTable] || mockData[table] || [])];

  if (!filters || filters.length === 0) {
    return results;
  }

  for (const filter of filters) {
    if (filter.type === 'eq') {
      results = results.filter((item) => item[filter.column] === filter.value);
    } else if (filter.type === 'ilike') {
      // Case-insensitive like
      const pattern = filter.pattern.replace(/%/g, '.*').toLowerCase();
      const regex = new RegExp(pattern);
      results = results.filter((item) => {
        const value = item[filter.column];
        if (value === null || value === undefined) return false;
        return regex.test(String(value).toLowerCase());
      });
    } else if (filter.type === 'in') {
      results = results.filter((item) => filter.values.includes(item[filter.column]));
    } else if (filter.type === 'gte') {
      results = results.filter((item) => item[filter.column] >= filter.value);
    } else if (filter.type === 'contains') {
      // Check if item's array column contains all values in filter.values
      results = results.filter((item) => {
        const itemArray = item[filter.column];
        if (!Array.isArray(itemArray)) return false;
        return filter.values.every((val: any) => itemArray.includes(val));
      });
    }
  }

  return results;
}

/**
 * Apply ordering to results
 */
function applyOrder(results: any[], orderBy?: { column: string; ascending: boolean }): any[] {
  if (!orderBy) {
    return results;
  }

  return [...results].sort((a, b) => {
    const aVal = a[orderBy.column];
    const bVal = b[orderBy.column];

    if (aVal < bVal) return orderBy.ascending ? -1 : 1;
    if (aVal > bVal) return orderBy.ascending ? 1 : -1;
    return 0;
  });
}

/**
 * Apply limit to results
 */
function applyLimit(results: any[], limit?: number): any[] {
  if (!limit) {
    return results;
  }

  return results.slice(0, limit);
}

/**
 * Mock createServiceClient from @yachtparty/shared
 */
export function mockCreateServiceClient(mockData: Parameters<typeof createMockSupabaseClient>[0]) {
  return jest.fn(() => createMockSupabaseClient(mockData));
}

/**
 * Mock publishEvent from @yachtparty/shared
 */
export function mockPublishEvent() {
  const mock = jest.fn().mockResolvedValue(undefined);
  return mock;
}

/**
 * Mock createAgentTask from @yachtparty/shared
 */
export function mockCreateAgentTask() {
  const mock = jest.fn().mockImplementation((task) => {
    return Promise.resolve({
      id: `mock-task-${Date.now()}`,
      ...task,
    });
  });
  return mock;
}

/**
 * Verify an event was published
 */
export function verifyEventPublished(
  publishEventMock: jest.Mock,
  expectedEvent: {
    event_type?: string;
    aggregate_id?: string;
    aggregate_type?: string;
    payloadIncludes?: Record<string, any>;
  }
) {
  const calls = publishEventMock.mock.calls;
  const matchingCall = calls.find((call) => {
    const event = call[0];

    if (expectedEvent.event_type && event.event_type !== expectedEvent.event_type) {
      return false;
    }

    if (expectedEvent.aggregate_id && event.aggregate_id !== expectedEvent.aggregate_id) {
      return false;
    }

    if (expectedEvent.aggregate_type && event.aggregate_type !== expectedEvent.aggregate_type) {
      return false;
    }

    if (expectedEvent.payloadIncludes) {
      for (const [key, value] of Object.entries(expectedEvent.payloadIncludes)) {
        if (event.payload[key] !== value) {
          return false;
        }
      }
    }

    return true;
  });

  expect(matchingCall).toBeDefined();
}

/**
 * Verify a task was created
 */
export function verifyTaskCreated(
  createTaskMock: jest.Mock,
  expectedTask: {
    task_type?: string;
    agent_type?: string;
    user_id?: string;
    priority?: string;
  }
) {
  const calls = createTaskMock.mock.calls;
  const matchingCall = calls.find((call) => {
    const task = call[0];

    if (expectedTask.task_type && task.task_type !== expectedTask.task_type) {
      return false;
    }

    if (expectedTask.agent_type && task.agent_type !== expectedTask.agent_type) {
      return false;
    }

    if (expectedTask.user_id && task.user_id !== expectedTask.user_id) {
      return false;
    }

    if (expectedTask.priority && task.priority !== expectedTask.priority) {
      return false;
    }

    return true;
  });

  expect(matchingCall).toBeDefined();
}
