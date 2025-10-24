/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@yachtparty/shared$': '<rootDir>/../packages/shared/src/index.ts',
    '^@yachtparty/shared/(.*)$': '<rootDir>/../packages/shared/src/$1',
    '^@yachtparty/agent-bouncer$': '<rootDir>/../packages/agents/bouncer/src/index.ts',
    '^@yachtparty/agent-concierge$': '<rootDir>/../packages/agents/concierge/src/index.ts',
    '^@yachtparty/agent-innovator$': '<rootDir>/../packages/agents/innovator/src/index.ts',
  },
  testTimeout: 180000, // 3 minutes default for LLM calls
  verbose: true,
  bail: false,
};
