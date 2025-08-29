/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: './jest-environment-config.cjs',
  // Run only repository tests under `tests/**`. Ignore built artifacts and legacy prototypes.
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/tests/'],
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
};
