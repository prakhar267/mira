declare module "cloudflare:workers" {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  }

  export const env: {
    SARVAM_API_KEY?: string;
    LUMA_ACCOUNTS?: KVNamespace;
    AI: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  };
}
