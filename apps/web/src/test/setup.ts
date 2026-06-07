/**
 * Vitest setup — runs before each test file.
 *
 * Loads @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
 * and polyfills any missing browser APIs we touch in the unit tests.
 */

import '@testing-library/jest-dom/vitest';
