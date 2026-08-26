import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeAccountPassword,
  validateChangePasswordInput,
} from "@/lib/account-password-change";

vi.mock("@/lib/accounts-storage", () => ({
  loadAccounts: vi.fn(),
  saveAccounts: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  USERS: {
    finalent: { companyName: "DIN Studio", password: "finalent" },
  },
}));

import { loadAccounts, saveAccounts } from "@/lib/accounts-storage";

const loadAccountsMock = vi.mocked(loadAccounts);
const saveAccountsMock = vi.mocked(saveAccounts);

describe("validateChangePasswordInput", () => {
  it("requires current and new passwords", () => {
    expect(validateChangePasswordInput("", "next").ok).toBe(false);
    expect(validateChangePasswordInput("cur", "").ok).toBe(false);
  });

  it("rejects same password", () => {
    const result = validateChangePasswordInput("abc", "abc");
    expect(result.ok).toBe(false);
  });

  it("accepts valid input", () => {
    const result = validateChangePasswordInput("old", "  new  ");
    expect(result).toEqual({ ok: true, currentPassword: "old", newPassword: "new" });
  });
});

describe("changeAccountPassword", () => {
  beforeEach(() => {
    loadAccountsMock.mockReset();
    saveAccountsMock.mockReset();
  });

  it("updates stored account password when current matches", async () => {
    loadAccountsMock.mockResolvedValue([
      {
        id: "alice",
        name: "Alice",
        companyName: "ACME",
        password: "old-pass",
        startDate: null,
        endDate: null,
        createdAt: 1,
      },
    ]);
    saveAccountsMock.mockResolvedValue({ ok: true });

    const result = await changeAccountPassword("alice", "old-pass", "new-pass");
    expect(result).toEqual({ ok: true });
    expect(saveAccountsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "alice", password: "new-pass" }),
    ]);
  });

  it("rejects wrong current password", async () => {
    loadAccountsMock.mockResolvedValue([
      {
        id: "alice",
        name: "Alice",
        companyName: "ACME",
        password: "old-pass",
        startDate: null,
        endDate: null,
        createdAt: 1,
      },
    ]);

    const result = await changeAccountPassword("alice", "wrong", "new-pass");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("wrong_password");
    }
  });

  it("does not persist legacy built-in accounts", async () => {
    loadAccountsMock.mockResolvedValue([]);
    const result = await changeAccountPassword("finalent", "finalent", "new-pass");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_supported");
    }
    expect(saveAccountsMock).not.toHaveBeenCalled();
  });
});
