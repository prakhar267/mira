declare module "cloudflare:workers" {
  export const env: {
    SARVAM_API_KEY?: string;
    AI: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  };
}
