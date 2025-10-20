module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  // Allow tests to import from @yachtparty/shared
  moduleNameMapper: {
    '@yachtparty/shared': '<rootDir>/../../shared/src',
  },
  // Increase timeout for LLM API calls
  testTimeout: 30000,
  // Use test-specific TypeScript config
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json'
    }
  }
};
