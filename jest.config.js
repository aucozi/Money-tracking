/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/', '<rootDir>/dist/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/store/**/*.ts', '!src/domain/types.ts'],
  coverageThreshold: {
    './src/domain/': { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
};
