import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  passwordSignIn: vi.fn().mockResolvedValue({}),
  create: vi.fn().mockResolvedValue({ user: { uid: "password-user" } }),
  validate: vi.fn().mockResolvedValue({ isValid: true }),
  reset: vi.fn().mockResolvedValue(undefined),
  verify: vi.fn().mockResolvedValue(undefined),
  popup: vi.fn().mockResolvedValue({}),
  googleParameters: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: mocks.passwordSignIn,
  createUserWithEmailAndPassword: mocks.create,
  validatePassword: mocks.validate,
  sendPasswordResetEmail: mocks.reset,
  sendEmailVerification: mocks.verify,
  signInWithPopup: mocks.popup,
  GoogleAuthProvider: class {
    setCustomParameters(parameters: unknown) {
      mocks.googleParameters(parameters);
    }
  },
}));
vi.mock("../src/lib/FirebaseClient.js", () => ({
  requireFirebaseAuth: () => ({ name: "test-auth" }),
}));

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    location: {
      href: "https://site.example.com/",
    },
  });
});
describe("Firebase password and Google operations", () => {
  it("trims emails, preserves passwords exactly, and does not store credentials", async () => {
    const account = await import("../src/lib/FirebaseAccount.js");
    await account.signInFirebaseWithPassword(" owner@example.com ", "  password  ");
    expect(mocks.passwordSignIn.mock.calls[0]?.slice(1)).toEqual([
      "owner@example.com",
      "  password  ",
    ]);
    await account.createFirebasePasswordAccount(" owner@example.com ", "  password  ");
    expect(mocks.validate.mock.calls[0]?.[1]).toBe("  password  ");
    expect(mocks.create.mock.calls[0]?.slice(1)).toEqual(["owner@example.com", "  password  "]);
    expect(storage.size).toBe(0);
  });

  it("reports actual project policy requirements before creating an account", async () => {
    mocks.validate.mockResolvedValueOnce({
      isValid: false,
      meetsMinPasswordLength: false,
      containsUppercaseLetter: false,
      passwordPolicy: { customStrengthOptions: { minPasswordLength: 12 } },
    });
    const account = await import("../src/lib/FirebaseAccount.js");
    await expect(
      account.createFirebasePasswordAccount("owner@example.com", "short"),
    ).rejects.toThrow("at least 12 characters, an uppercase letter");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requests Google account selection using the actual popup operation", async () => {
    const account = await import("../src/lib/FirebaseAccount.js");
    await account.signInFirebaseWithGoogle();
    expect(mocks.googleParameters).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(mocks.popup).toHaveBeenCalledOnce();
  });

  it("sends reset/verification actions to the supplied return path and propagates failure", async () => {
    const account = await import("../src/lib/FirebaseAccount.js");
    const redirect = "https://site.example.com/d/design";
    await account.resetFirebasePassword(" owner@example.com ", redirect);
    expect(mocks.reset.mock.calls[0]?.slice(1)).toEqual(["owner@example.com", { url: redirect }]);
    const user = await account.createFirebasePasswordAccount("owner@example.com", "password");
    await account.sendFirebaseVerification(user, redirect);
    expect(mocks.verify).toHaveBeenCalledWith(user, { url: redirect });
    mocks.reset.mockRejectedValueOnce(new Error("Reset delivery failed."));
    await expect(account.resetFirebasePassword("owner@example.com", redirect)).rejects.toThrow(
      "Reset delivery failed",
    );
  });

  it.each([
    ["auth/invalid-credential", "Email or password is incorrect."],
    ["auth/popup-closed-by-user", "Google sign-in was cancelled"],
    ["auth/popup-blocked", "Allow popups"],
    ["auth/unauthorized-domain", "authorized domains"],
    ["auth/email-already-in-use", "reset your password"],
  ])("surfaces an actionable %s error", async (code, message) => {
    const account = await import("../src/lib/FirebaseAccount.js");
    expect(
      account.firebaseSignInError(Object.assign(new Error("SDK failure"), { code })),
    ).toContain(message);
  });
  it("reports reset delivery failure without claiming a successful email", async () => {
    const account = await import("../src/lib/FirebaseAccount.js");
    const failure = Object.assign(new Error("SDK failure"), { code: "auth/user-not-found" });
    expect(account.firebaseSignInError(failure, "reset")).toContain("could not send a reset email");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});
