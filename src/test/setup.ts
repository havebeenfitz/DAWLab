import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Browser mocks; skipped for suites that opt into `@vitest-environment node`.
if (typeof window !== 'undefined') {
  // Node 25+ ships its own global localStorage (undefined without --localstorage-file),
  // which shadows the DOM environment's. Use the DOM one, like the app's renderer does.
  let storageWorks = false;
  try { storageWorks = typeof globalThis.localStorage?.clear === 'function'; } catch { /* getter can throw */ }
  if (!storageWorks) {
    const StorageCtor = (window as any).Storage;
    const storage: Storage = StorageCtor ? new StorageCtor() : createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  }

  // Mock electron APIs
  (global as any).window.electronAPI = {
    pickFolder: vi.fn(),
    initProject: vi.fn(),
    cloneProject: vi.fn(),
    openProject: vi.fn(),
    deleteProject: vi.fn(),
  };

  (global as any).window.ipcRenderer = {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
    unobserve() {}
  } as any;

  // Mock ResizeObserver
  global.ResizeObserver = class ResizeObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
  } as any;
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
  };
}
