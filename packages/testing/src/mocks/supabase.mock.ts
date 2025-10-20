/**
 * Supabase Mock Implementation
 *
 * Provides in-memory mock of Supabase client for testing.
 * Supports query builder pattern, realtime subscriptions, and CRUD operations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// In-memory data storage
interface MockDatabase {
  [table: string]: Record<string, any>[];
}

class MockSupabaseClient {
  private database: MockDatabase = {};
  private subscriptions: Map<string, any> = new Map();

  // Query builder state
  private currentTable: string = '';
  private currentFilters: any[] = [];
  private currentOrder: { column: string; ascending: boolean } | null = null;
  private currentLimit: number | null = null;
  private currentSelect: string = '*';
  private updateData: any = null;

  constructor() {
    this.reset();
  }

  /**
   * Reset database to initial state
   */
  reset() {
    this.database = {
      users: [],
      conversations: [],
      messages: [],
      events: [],
      agent_tasks: [],
      message_queue: [],
      user_message_budget: [],
      user_priorities: [],
      solution_workflows: [],
      intro_opportunities: [],
      community_requests: [],
      community_responses: [],
      credit_events: [],
      agent_actions_log: [],
    };
    this.subscriptions.clear();
    this.resetQuery();
  }

  /**
   * Reset query builder state
   */
  private resetQuery() {
    this.currentTable = '';
    this.currentFilters = [];
    this.currentOrder = null;
    this.currentLimit = null;
    this.currentSelect = '*';
  }

  /**
   * Start query on a table
   */
  from(table: string) {
    this.currentTable = table;
    this.currentFilters = [];
    this.currentOrder = null;
    this.currentLimit = null;
    this.currentSelect = '*';

    return this;
  }

  /**
   * Select columns
   */
  select(columns: string = '*', options?: any) {
    this.currentSelect = columns;
    return this;
  }

  /**
   * Insert records
   */
  insert(data: any | any[]) {
    const records = Array.isArray(data) ? data : [data];
    const table = this.database[this.currentTable];

    if (!table) {
      return {
        data: null,
        error: { message: `Table ${this.currentTable} not found` },
      };
    }

    const insertedRecords = records.map((record) => ({
      ...record,
      id: record.id || this.generateId(),
      created_at: record.created_at || new Date().toISOString(),
    }));

    table.push(...insertedRecords);

    this.resetQuery();

    return {
      data: insertedRecords.length === 1 ? insertedRecords[0] : insertedRecords,
      error: null,
      select: () => ({
        data: insertedRecords.length === 1 ? insertedRecords[0] : insertedRecords,
        error: null,
        single: () => ({
          data: insertedRecords[0],
          error: null,
        }),
      }),
      single: () => ({
        data: insertedRecords[0],
        error: null,
      }),
    };
  }

  /**
   * Update records
   */
  update(data: any) {
    // Store the data to apply, but don't execute yet (allows chaining)
    this.currentTable = this.currentTable; // Keep table reference
    this.updateData = data;

    return this;
  }

  /**
   * Execute update (called after filters)
   */
  private executeUpdate() {
    const table = this.database[this.currentTable];

    if (!table || !this.updateData) {
      return {
        data: null,
        error: { message: `Table ${this.currentTable} not found or no update data` },
      };
    }

    const matchingRecords = this.applyFilters(table);

    matchingRecords.forEach((record) => {
      Object.assign(record, this.updateData, {
        updated_at: new Date().toISOString(),
      });
    });

    const data = matchingRecords.length === 1 ? matchingRecords[0] : matchingRecords;

    this.updateData = null;
    this.resetQuery();

    return {
      data,
      error: null,
      select: () => ({
        data,
        error: null,
        single: () => ({
          data: matchingRecords[0],
          error: null,
        }),
      }),
    };
  }

  /**
   * Delete records
   */
  delete() {
    const table = this.database[this.currentTable];

    if (!table) {
      return {
        data: null,
        error: { message: `Table ${this.currentTable} not found` },
      };
    }

    const matchingRecords = this.applyFilters(table);
    const matchingIds = matchingRecords.map((r) => r.id);

    // Remove matching records
    this.database[this.currentTable] = table.filter(
      (record) => !matchingIds.includes(record.id)
    );

    this.resetQuery();

    return {
      data: matchingRecords,
      error: null,
    };
  }

  /**
   * Filter: equality
   */
  eq(column: string, value: any) {
    this.currentFilters.push({ type: 'eq', column, value });

    // If we have pending update data, execute it now
    if (this.updateData) {
      return this.executeUpdate();
    }

    return this;
  }

  /**
   * Filter: not equal
   */
  neq(column: string, value: any) {
    this.currentFilters.push({ type: 'neq', column, value });
    return this;
  }

  /**
   * Filter: greater than or equal
   */
  gte(column: string, value: any) {
    this.currentFilters.push({ type: 'gte', column, value });
    return this;
  }

  /**
   * Filter: less than or equal
   */
  lte(column: string, value: any) {
    this.currentFilters.push({ type: 'lte', column, value });
    return this;
  }

  /**
   * Filter: in array
   */
  in(column: string, values: any[]) {
    this.currentFilters.push({ type: 'in', column, values });
    return this;
  }

  /**
   * Order results
   */
  order(column: string, options?: { ascending?: boolean }) {
    this.currentOrder = {
      column,
      ascending: options?.ascending !== false,
    };
    return this;
  }

  /**
   * Limit results
   */
  limit(count: number) {
    this.currentLimit = count;
    return this;
  }

  /**
   * Execute query and return single record
   */
  single() {
    const table = this.database[this.currentTable];

    if (!table) {
      return Promise.resolve({
        data: null,
        error: { message: `Table ${this.currentTable} not found` },
      });
    }

    let results = this.applyFilters(table);

    if (this.currentOrder) {
      results = this.applyOrder(results);
    }

    const record = results[0] || null;

    this.resetQuery();

    return Promise.resolve({
      data: record,
      error: record ? null : { message: 'No rows found' },
    });
  }

  /**
   * Execute query (return promise)
   */
  then(resolve: any, reject?: any) {
    const table = this.database[this.currentTable];

    if (!table) {
      const error = { message: `Table ${this.currentTable} not found` };
      if (reject) {
        reject(error);
      } else {
        resolve({ data: null, error });
      }
      return;
    }

    let results = this.applyFilters(table);

    if (this.currentOrder) {
      results = this.applyOrder(results);
    }

    if (this.currentLimit) {
      results = results.slice(0, this.currentLimit);
    }

    this.resetQuery();

    resolve({
      data: results,
      error: null,
      count: results.length,
    });
  }

  /**
   * Apply filters to records
   */
  private applyFilters(records: any[]): any[] {
    return records.filter((record) => {
      return this.currentFilters.every((filter) => {
        const value = record[filter.column];

        switch (filter.type) {
          case 'eq':
            return value === filter.value;
          case 'neq':
            return value !== filter.value;
          case 'gte':
            return value >= filter.value;
          case 'lte':
            return value <= filter.value;
          case 'in':
            return filter.values.includes(value);
          default:
            return true;
        }
      });
    });
  }

  /**
   * Apply ordering to records
   */
  private applyOrder(records: any[]): any[] {
    if (!this.currentOrder) return records;

    const { column, ascending } = this.currentOrder;

    return [...records].sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];

      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });
  }

  /**
   * Generate UUID for new records
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * RPC calls (stored procedures)
   */
  rpc(functionName: string, params?: any) {
    // Mock specific RPC functions
    if (functionName === 'increment_message_budget') {
      const { p_user_id, p_date } = params;
      const budget = this.database.user_message_budget.find(
        (b: any) => b.user_id === p_user_id && b.date === p_date
      );

      if (budget) {
        budget.messages_sent += 1;
        budget.last_message_at = new Date().toISOString();
      }

      return Promise.resolve({ data: null, error: null });
    }

    return Promise.resolve({ data: null, error: null });
  }

  /**
   * Realtime subscriptions
   */
  channel(name: string) {
    return {
      on: (event: string, filter: any, callback: any) => {
        this.subscriptions.set(name, { event, filter, callback });
        return this;
      },
      subscribe: (callback?: any) => {
        if (callback) callback('SUBSCRIBED');
        return this;
      },
      unsubscribe: () => {
        this.subscriptions.delete(name);
        return Promise.resolve({ error: null });
      },
    };
  }

  /**
   * Trigger a realtime event (for testing)
   */
  triggerRealtimeEvent(channel: string, event: string, payload: any) {
    const subscription = this.subscriptions.get(channel);
    if (subscription && subscription.callback) {
      subscription.callback(payload);
    }
  }

  /**
   * Get current database state (for testing/debugging)
   */
  getDatabase() {
    return this.database;
  }

  /**
   * Seed database with test data
   */
  seedDatabase(data: Partial<MockDatabase>) {
    Object.keys(data).forEach((table) => {
      if (this.database[table] && data[table]) {
        this.database[table] = data[table];
      }
    });
  }
}

// Export singleton instance
export const mockSupabase = new MockSupabaseClient();

/**
 * Reset mock to initial state
 */
export function resetSupabaseMock() {
  mockSupabase.reset();
}

/**
 * Create a mock Supabase client (for dependency injection)
 */
export function createMockSupabaseClient(): SupabaseClient {
  return mockSupabase as any;
}

// Type declarations
declare global {
  var mockSupabase: MockSupabaseClient;
}
