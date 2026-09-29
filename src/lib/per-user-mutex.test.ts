import { describe, expect, it } from "vitest";
import { runExclusivePerUser } from "./per-user-mutex";

describe("runExclusivePerUser", () => {
  it("does not start the next task until a timed-out task has finished writing", async () => {
    const userId = `mutex-overlap-${Date.now()}`;
    let firstFinished = false;
    let secondSawFinished = false;
    const first = runExclusivePerUser(
      userId,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        firstFinished = true;
        return "first";
      },
      { timeoutMs: 20 }
    );
    const second = runExclusivePerUser(
      userId,
      async () => {
        secondSawFinished = firstFinished;
        return "second";
      },
      { timeoutMs: 500 }
    );
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(secondSawFinished).toBe(true);
  });
});
