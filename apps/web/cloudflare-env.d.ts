declare module "cloudflare:workers" {
  export const env: {
    AI: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  };
}
