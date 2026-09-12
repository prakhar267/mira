declare module "cloudflare:workers" {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
  }

  export const env: {
    MIRA_STORE?: { idFromName(name: string): string; get(id: string): { fetch(url: string, init?: RequestInit): Promise<Response> } };
    MIRA_RECOVERY_TEST?: { idFromName(name: string): string; get(id: string): { fetch(url: string, init?: RequestInit): Promise<Response> } };
    MIRA_ADMIN_KEY?: string;
    MIRA_ALERT_WEBHOOK?: string;
    MIRA_SUPPORT_OWNER?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    SITE_ORIGIN?: string;
    DODO_PAYMENTS_API_KEY?: string;
    DODO_PAYMENTS_WEBHOOK_KEY?: string;
    DODO_PAYMENTS_ENVIRONMENT?: string;
    DODO_PRODUCT_ID?: string;
    BILLING_ENABLED?: string;
    BILLING_PRICE_LABEL?: string;
    CHAT_DAILY_LIMIT?:string;
    SPEECH_DAILY_LIMIT?:string;
    TRANSCRIBE_DAILY_LIMIT?:string;
    LUMA_ACCOUNTS?: KVNamespace;
    CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
    AI: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  };
}
