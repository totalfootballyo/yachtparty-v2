#!/usr/bin/env tsx

/**
 * Bouncer Agent Test Chat Interface
 *
 * Interactive CLI tool for testing the Bouncer agent onboarding flow
 * without requiring Twilio integration.
 *
 * Features:
 * - Interactive readline interface
 * - Colorized output for better readability
 * - Real-time state display
 * - Test user and conversation management
 * - Database recording of all messages
 * - Commands: /help, /reset, /status, /exit
 *
 * Usage:
 *   npm run test-chat
 *
 * Environment variables required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   ANTHROPIC_API_KEY
 */

import * as readline from 'readline';
import { createServiceClient, User, Conversation, Message } from '@yachtparty/shared';
import { invokeBouncerAgent } from './src/index';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Verify API key is loaded
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not found in environment!');
  console.error('   Looking for .env at:', path.join(__dirname, '.env'));
  process.exit(1);
}

// ANSI color codes for colorized output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Test configuration
const TEST_PHONE_NUMBER = '+15555550100';
const TEST_USER_ID_KEY = 'test_user_id'; // Store in memory for session

// Global state for the session
let testUser: User | null = null;
let testConversation: Conversation | null = null;
let rl: readline.Interface | null = null;

/**
 * Validates required environment variables
 */
function validateEnvironment(): void {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`${colors.red}${colors.bright}Error: Missing required environment variables:${colors.reset}`);
    missing.forEach(key => console.error(`  - ${key}`));
    console.error(`\nPlease create a .env file based on .env.example`);
    process.exit(1);
  }
}

/**
 * Tests database connection
 */
async function testDatabaseConnection(): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('users').select('id').limit(1);

    if (error) {
      console.error(`${colors.red}Database connection error: ${error.message}${colors.reset}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`${colors.red}Failed to connect to database:${colors.reset}`, error);
    return false;
  }
}

/**
 * Creates or retrieves test user
 */
async function getOrCreateTestUser(): Promise<User> {
  const supabase = createServiceClient();

  // Try to find existing test user
  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', TEST_PHONE_NUMBER)
    .single();

  if (existingUser) {
    console.log(`${colors.cyan}Using existing test user: ${existingUser.id}${colors.reset}`);
    return existingUser as User;
  }

  // Create new test user
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      phone_number: TEST_PHONE_NUMBER,
      verified: false,
      innovator: false,
      expert_connector: false,
      poc_agent_type: 'bouncer',
      credit_balance: 0,
      status_level: 'member',
      created_at: new Date(),
      updated_at: new Date()
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test user: ${error.message}`);
  }

  console.log(`${colors.green}Created new test user: ${newUser.id}${colors.reset}`);
  return newUser as User;
}

/**
 * Creates a new conversation for the test user
 */
async function createTestConversation(userId: string): Promise<Conversation> {
  const supabase = createServiceClient();

  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      phone_number: TEST_PHONE_NUMBER,
      status: 'active',
      messages_since_summary: 0,
      created_at: new Date(),
      updated_at: new Date()
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create conversation: ${error.message}`);
  }

  console.log(`${colors.green}Created new conversation: ${conversation.id}${colors.reset}`);
  return conversation as Conversation;
}

/**
 * Records a message in the database
 */
async function recordMessage(
  conversationId: string,
  userId: string,
  role: 'user' | 'bouncer',
  content: string,
  direction: 'inbound' | 'outbound'
): Promise<Message> {
  const supabase = createServiceClient();

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      direction,
      status: direction === 'outbound' ? 'delivered' : null,
      created_at: new Date(),
      sent_at: direction === 'outbound' ? new Date() : null,
      delivered_at: direction === 'outbound' ? new Date() : null
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to record message: ${error.message}`);
  }

  // Update conversation last_message_at
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date(),
      messages_since_summary: supabase.rpc('increment', { x: 1 })
    })
    .eq('id', conversationId);

  return message as Message;
}

/**
 * Reloads user from database to get updated fields
 */
async function reloadUser(userId: string): Promise<User> {
  const supabase = createServiceClient();

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`Failed to reload user: ${error.message}`);
  }

  return user as User;
}

/**
 * Displays the header with current session info
 */
function displayHeader(user: User, conversation: Conversation): void {
  console.clear();
  console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}           BOUNCER AGENT TEST CHAT${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.dim}User ID:${colors.reset} ${user.id}`);
  console.log(`${colors.dim}Phone:${colors.reset} ${user.phone_number}`);
  console.log(`${colors.dim}Conversation ID:${colors.reset} ${conversation.id}`);
  console.log(`${colors.dim}Status:${colors.reset} ${user.verified ? `${colors.green}Verified${colors.reset}` : `${colors.yellow}Not Verified${colors.reset}`}`);
  console.log();
  displayUserState(user);
  console.log(`${colors.cyan}───────────────────────────────────────────────────────────${colors.reset}`);
  console.log(`${colors.dim}Commands:${colors.reset} ${colors.yellow}/help /reset /status /exit${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log();
}

/**
 * Displays current user state (collected fields)
 */
function displayUserState(user: User): void {
  const fields = [
    { label: 'First Name', value: user.first_name, key: 'first_name' },
    { label: 'Last Name', value: user.last_name, key: 'last_name' },
    { label: 'Company', value: user.company, key: 'company' },
    { label: 'Title', value: user.title, key: 'title' },
    { label: 'Email', value: user.email, key: 'email' },
    { label: 'LinkedIn', value: user.linkedin_url, key: 'linkedin_url' },
  ];

  console.log(`${colors.bright}Collected Information:${colors.reset}`);
  fields.forEach(field => {
    const status = field.value
      ? `${colors.green}✓${colors.reset}`
      : `${colors.red}✗${colors.reset}`;
    const displayValue = field.value || `${colors.dim}(not provided)${colors.reset}`;
    console.log(`  ${status} ${field.label}: ${displayValue}`);
  });
  console.log();
}

/**
 * Displays help information
 */
function displayHelp(): void {
  console.log(`${colors.bright}${colors.cyan}Available Commands:${colors.reset}`);
  console.log(`  ${colors.yellow}/help${colors.reset}   - Show this help message`);
  console.log(`  ${colors.yellow}/reset${colors.reset}  - Reset test user (clear all data)`);
  console.log(`  ${colors.yellow}/status${colors.reset} - Show current user state and progress`);
  console.log(`  ${colors.yellow}/exit${colors.reset}   - Exit the test chat`);
  console.log();
  console.log(`${colors.bright}${colors.cyan}Test Scenarios:${colors.reset}`);
  console.log(`  1. Basic onboarding: Provide name, company, title, email`);
  console.log(`  2. Out-of-order responses: Provide info in any order`);
  console.log(`  3. Incomplete responses: See how agent handles vague answers`);
  console.log(`  4. Multi-field responses: "I'm John Smith from Acme Corp"`);
  console.log();
}

/**
 * Resets test user data
 */
async function resetTestUser(): Promise<void> {
  if (!testUser) return;

  const supabase = createServiceClient();

  console.log(`${colors.yellow}Resetting test user...${colors.reset}`);

  // Update user to clear all onboarding fields
  const { error } = await supabase
    .from('users')
    .update({
      first_name: null,
      last_name: null,
      company: null,
      title: null,
      email: null,
      linkedin_url: null,
      verified: false,
      poc_agent_type: 'bouncer',
      updated_at: new Date()
    })
    .eq('id', testUser.id);

  if (error) {
    console.error(`${colors.red}Failed to reset user: ${error.message}${colors.reset}`);
    return;
  }

  // Create new conversation
  testConversation = await createTestConversation(testUser.id);
  testUser = await reloadUser(testUser.id);

  console.log(`${colors.green}User reset successfully!${colors.reset}`);
  console.log();
}

/**
 * Handles user message and invokes bouncer agent
 */
async function handleUserMessage(content: string): Promise<void> {
  if (!testUser || !testConversation) {
    console.error(`${colors.red}Error: No active session${colors.reset}`);
    return;
  }

  try {
    // Record user message
    const userMessage = await recordMessage(
      testConversation.id,
      testUser.id,
      'user',
      content,
      'inbound'
    );

    // Display user message
    console.log();
    console.log(`${colors.bright}${colors.green}You:${colors.reset} ${content}`);
    console.log();

    // Show thinking indicator
    console.log(`${colors.dim}[Agent is thinking...]${colors.reset}`);

    // Invoke bouncer agent
    const startTime = Date.now();
    const response = await invokeBouncerAgent(
      userMessage,
      testUser,
      testConversation
    );
    const duration = Date.now() - startTime;

    // Display agent response
    if (response.message) {
      console.log(`${colors.bright}${colors.blue}Agent:${colors.reset} ${response.message}`);
      console.log();

      // Record agent message
      await recordMessage(
        testConversation.id,
        testUser.id,
        'bouncer',
        response.message,
        'outbound'
      );
    }

    // Display actions taken
    if (response.actions && response.actions.length > 0) {
      console.log(`${colors.dim}[Actions taken:]${colors.reset}`);
      response.actions.forEach(action => {
        console.log(`${colors.dim}  • ${action.type}${colors.reset}`);
        if (action.reason) {
          console.log(`${colors.dim}    Reason: ${action.reason}${colors.reset}`);
        }
      });
      console.log();
    }

    // Display reasoning if available
    if (response.reasoning) {
      console.log(`${colors.dim}[Agent reasoning: ${response.reasoning}]${colors.reset}`);
      console.log();
    }

    // Reload user to see updated fields
    const previousUser = { ...testUser };
    testUser = await reloadUser(testUser.id);

    // Display field updates
    const updatedFields = getUpdatedFields(previousUser, testUser);
    if (updatedFields.length > 0) {
      console.log(`${colors.cyan}[User data updated:]${colors.reset}`);
      updatedFields.forEach(({ field, oldValue, newValue }) => {
        console.log(`${colors.cyan}  • ${field}: ${colors.dim}"${oldValue || 'null'}"${colors.reset} → ${colors.green}"${newValue}"${colors.reset}`);
      });
      console.log();
    }

    // Display verification status
    if (testUser.verified && !previousUser.verified) {
      console.log(`${colors.bright}${colors.green}🎉 User verified! Onboarding complete.${colors.reset}`);
      console.log();
    }

    // Display performance metrics
    console.log(`${colors.dim}[Response time: ${duration}ms]${colors.reset}`);
    console.log();

  } catch (error) {
    console.error(`${colors.red}Error processing message:${colors.reset}`, error);
    console.log();
  }
}

/**
 * Gets fields that were updated between two user objects
 */
function getUpdatedFields(oldUser: User, newUser: User): Array<{ field: string; oldValue: any; newValue: any }> {
  const fields = ['first_name', 'last_name', 'company', 'title', 'email', 'linkedin_url', 'verified', 'poc_agent_type'];
  const updates: Array<{ field: string; oldValue: any; newValue: any }> = [];

  fields.forEach(field => {
    const oldValue = (oldUser as any)[field];
    const newValue = (newUser as any)[field];

    if (oldValue !== newValue) {
      updates.push({ field, oldValue, newValue });
    }
  });

  return updates;
}

/**
 * Displays current status
 */
function displayStatus(): void {
  if (!testUser || !testConversation) {
    console.error(`${colors.red}No active session${colors.reset}`);
    return;
  }

  console.log();
  console.log(`${colors.bright}${colors.cyan}Current Status:${colors.reset}`);
  console.log();
  displayUserState(testUser);
  console.log(`${colors.dim}Verified:${colors.reset} ${testUser.verified ? `${colors.green}Yes${colors.reset}` : `${colors.yellow}No${colors.reset}`}`);
  console.log(`${colors.dim}Agent Type:${colors.reset} ${testUser.poc_agent_type}`);
  console.log();
}

/**
 * Main interactive loop
 */
async function startInteractiveChat(): Promise<void> {
  // Create readline interface
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.bright}${colors.green}You:${colors.reset} `
  });

  // Display header
  if (testUser && testConversation) {
    displayHeader(testUser, testConversation);
  }

  // Show prompt
  rl.prompt();

  // Handle user input
  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      const command = input.toLowerCase();

      switch (command) {
        case '/help':
          displayHelp();
          break;

        case '/reset':
          await resetTestUser();
          if (testUser && testConversation) {
            displayHeader(testUser, testConversation);
          }
          break;

        case '/status':
          displayStatus();
          break;

        case '/exit':
          console.log(`${colors.cyan}Goodbye!${colors.reset}`);
          process.exit(0);
          break;

        default:
          console.log(`${colors.red}Unknown command: ${command}${colors.reset}`);
          console.log(`${colors.dim}Type /help for available commands${colors.reset}`);
          console.log();
      }

      rl.prompt();
      return;
    }

    // Handle regular message
    await handleUserMessage(input);
    rl.prompt();
  });

  // Handle CTRL+C
  rl.on('SIGINT', () => {
    console.log();
    console.log(`${colors.cyan}Goodbye!${colors.reset}`);
    process.exit(0);
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.clear();

  console.log(`${colors.bright}${colors.cyan}Bouncer Agent Test Chat${colors.reset}`);
  console.log(`${colors.dim}Initializing...${colors.reset}`);
  console.log();

  // Validate environment
  validateEnvironment();

  // Test database connection
  console.log(`${colors.dim}Testing database connection...${colors.reset}`);
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error(`${colors.red}Failed to connect to database. Please check your SUPABASE_URL and SUPABASE_SERVICE_KEY.${colors.reset}`);
    process.exit(1);
  }
  console.log(`${colors.green}✓ Database connected${colors.reset}`);
  console.log();

  // Create or get test user
  console.log(`${colors.dim}Setting up test user...${colors.reset}`);
  try {
    testUser = await getOrCreateTestUser();
    testConversation = await createTestConversation(testUser.id);
    console.log(`${colors.green}✓ Test environment ready${colors.reset}`);
    console.log();
  } catch (error) {
    console.error(`${colors.red}Failed to set up test environment:${colors.reset}`, error);
    process.exit(1);
  }

  // Wait a moment before starting
  await new Promise(resolve => setTimeout(resolve, 500));

  // Start interactive chat
  await startInteractiveChat();
}

// Run the main function
main().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
