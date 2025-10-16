/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: './jest-environment-config.cjs',
  // Run repository tests under `tests/**` and legacy suites under `src/tests/**`.
  testMatch: [
    '<rootDir>/tests/**/*.(spec|test).ts',
    '<rootDir>/src/tests/**/*.(spec|test).ts'
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/tests/e2e/'],
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
};
