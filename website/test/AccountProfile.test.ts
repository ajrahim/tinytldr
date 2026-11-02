import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountProfileInputSchema } from "@tinytldr/core";
import { firebaseAccountProfile } from "../src/lib/AccountProfile.js";

describe("Account profile contract and SDK metadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it("trims optional names, accepts exactly 80 characters, and rejects 81 or extra fields", () => {
    expect(AccountProfileInputSchema.parse({ displayName: "  Tiny Author  " }).displayName).toBe(
      "Tiny Author",
    );
    expect(AccountProfileInputSchema.parse({ displayName: "   " }).displayName).toBe("");
    expect(
      AccountProfileInputSchema.parse({ displayName: "n".repeat(80) }).displayName,
    ).toHaveLength(80);
    expect(AccountProfileInputSchema.safeParse({ displayName: "n".repeat(81) }).success).toBe(
      false,
    );
    expect(AccountProfileInputSchema.safeParse({ displayName: 42 }).success).toBe(false);
    expect(
      AccountProfileInputSchema.safeParse({ displayName: "Name", email: "other@example.com" })
        .success,
    ).toBe(false);
  });

  it("reads Firebase verification truthfully, including an unset name and email", () => {
    expect(
      firebaseAccountProfile({
        uid: "firebase-owner",
        email: null,
        displayName: null,
        emailVerified: false,
      }),
    ).toEqual({ id: "firebase-owner", email: undefined, displayName: "", emailVerified: false });
    expect(
      firebaseAccountProfile({
        uid: "firebase-owner",
        email: "creator@example.com",
        displayName: "Creator",
        emailVerified: true,
      }).emailVerified,
    ).toBe(true);
  });
});
