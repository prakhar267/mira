import { describe, expect, it } from "vitest";
import { InMemoryCompanionRepository, inMemorySeed, seedUser } from "../src";

describe("InMemoryCompanionRepository", () => {
  it("applies activity rewards idempotently", async () => {
    const repository = new InMemoryCompanionRepository(inMemorySeed);
    const first = await repository.completeActivity(seedUser.id, "activity-reflection", "idem-1");
    const second = await repository.completeActivity(seedUser.id, "activity-reflection", "idem-1");
    expect(second).toEqual(first);
  });

  it("rejects cross-user memory writes", async () => {
    const repository = new InMemoryCompanionRepository(inMemorySeed);
    const memory = { ...inMemorySeed.memories[0]!, id: "foreign", userId: "other-user" };
    await expect(repository.upsertMemory(seedUser.id, memory)).rejects.toThrow("Cross-user");
  });
});
