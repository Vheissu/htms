/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: './jest-environment-config.cjs',
  testMatch: ['<rootDir>/tests/**/*.(spec|test).ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/tests/e2e/'],
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 65,
      statements: 65,
    },
  },
};
