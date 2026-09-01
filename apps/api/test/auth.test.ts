import { describe, expect, it } from "vitest";
import { AuthService, InMemoryAuthStore, hashPassword, verifyPassword } from "../src/auth";

describe("production auth primitives", () => {
  it("hashes passwords with a random salt", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(await verifyPassword("wrong password", first)).toBe(false);
  });

  it("issues signed access tokens and rotates refresh tokens once", async () => {
    const auth = new AuthService(new InMemoryAuthStore(), "a-production-strength-secret-with-32-chars");
    const registered = await auth.register("person@example.com", "correct horse battery staple", "00000000-0000-4000-8000-000000000099");
    expect((await auth.verifyAccessToken(registered.tokens.accessToken))?.userId).toBe("00000000-0000-4000-8000-000000000099");
    const rotated = await auth.rotate(registered.tokens.refreshToken);
    expect(rotated).not.toBeNull();
    expect(await auth.verifyAccessToken(registered.tokens.accessToken)).toBeNull();
    expect(await auth.rotate(registered.tokens.refreshToken)).toBeNull();
  });

  it("revokes access immediately on logout", async () => {
    const auth = new AuthService(new InMemoryAuthStore(), "a-production-strength-secret-with-32-chars");
    const registered = await auth.register("person@example.com", "correct horse battery staple", "00000000-0000-4000-8000-000000000099");
    await auth.logout(registered.tokens.accessToken);
    expect(await auth.verifyAccessToken(registered.tokens.accessToken)).toBeNull();
  });

  it("consumes verification challenges only once", async () => {
    const auth = new AuthService(new InMemoryAuthStore(), "a-production-strength-secret-with-32-chars");
    const registered = await auth.register("person@example.com", "correct horse battery staple", "00000000-0000-4000-8000-000000000099");
    expect(await auth.verifyEmail(registered.verificationToken)).toBe(true);
    expect(await auth.verifyEmail(registered.verificationToken)).toBe(false);
  });
});
