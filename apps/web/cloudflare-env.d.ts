declare module "cloudflare:workers" {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
  }

  export const env: {
    SARVAM_API_KEY?: string;
    LUMA_ACCOUNTS?: KVNamespace;
    CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
    AI: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  };
}
