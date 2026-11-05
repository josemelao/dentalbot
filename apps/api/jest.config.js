module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 20000,
  clearMocks: true,
  setupFiles: ['<rootDir>/test/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
};
