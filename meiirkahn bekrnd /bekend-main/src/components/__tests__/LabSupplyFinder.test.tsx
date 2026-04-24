import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../context/AuthContext';
import { LabSupplyFinder } from '../LabSupplyFinder';

beforeEach(() => {
  globalThis.fetch = vi.fn((input) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          String(input).includes('/api/auth/me')
            ? {
                user: {
                  id: 'test-user',
                  email: 'test@example.com',
                  name: 'Test User',
                  role: 'user',
                  createdAt: new Date().toISOString(),
                },
              }
            : { total: 0, page: 1, limit: 8, supplies: [] },
        ),
    }),
  ) as unknown as typeof fetch;
  document.body.innerHTML = '';
});

describe('LabSupplyFinder', () => {
  it('renders search input and filter buttons', () => {
    const container = document.createElement('div');

    act(() => {
      createRoot(container).render(
        <AuthProvider>
          <LabSupplyFinder />
        </AuthProvider>,
      );
    });

    expect(container.querySelector('input[placeholder*="атауы"]')).not.toBeNull();
    expect(container.querySelector('button.filter-chip')).not.toBeNull();
  });
});
