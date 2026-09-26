/** Platform-only imports resolve here exclusively under the Node unit config.
 * Integration tests populate synthetic bindings; other tests use vi.mock.
 * No real environment variables or Cloudflare credentials are loaded. */
export const env: Record<string, unknown> = {};
