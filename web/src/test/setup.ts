import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Default fetch mock so component tests never hit the network.
if (!globalThis.fetch) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis.fetch as any) = vi.fn(async () => ({
  ok: false,
  status: 500,
  json: async () => ({})
}));
