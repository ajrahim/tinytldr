import { describe, expect, it, vi } from "vitest";
import { createDesignGateway } from "../src/DesignGateway.js";
import { DesignRequestError } from "../src/DesignService.js";
import { projectFromDocument } from "@tinytldr/core";
import { createBlankDocument } from "../../src/lib/WorkspaceTemplates.js";

describe("Firebase design HTTP boundary", () => {
  const id = "bb416ad9-fd5b-459c-9891-07822fe8ac60";
  function setup() {
    const execute = vi.fn().mockResolvedValue({ id });
    const verifyUser = vi.fn().mockResolvedValue("verified-firebase-uid");
    const reportError = vi.fn();
    const gateway = createDesignGateway({
      service: { execute },
      verifyUser,
      reportError,
      allowedOrigins: ["https://site.example.com"],
    });
    return { execute, verifyUser, reportError, gateway };
  }
  function request(body: unknown, authorization?: string, origin = "https://site.example.com") {
    return new Request("https://designs.example.com", {
      method: "POST",
      headers: { Origin: origin, ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify(body),
    });
  }

  it("binds all operations to the verified token, not request-supplied account IDs", async () => {
    const { gateway, execute, verifyUser } = setup();
    const result = await gateway(request({ action: "get", id }, "Bearer test-token"));
    expect(result.status).toBe(200);
    expect(verifyUser).toHaveBeenCalledWith("test-token");
    expect(execute).toHaveBeenCalledWith({ action: "get", id }, "verified-firebase-uid");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("https://site.example.com");
    expect((await gateway(request({ action: "get", id, userId: "forged" }))).status).toBe(400);
  });

  it("rejects invalid tokens without falling back to guest access", async () => {
    const { gateway, execute, verifyUser } = setup();
    verifyUser.mockResolvedValueOnce(null);
    expect((await gateway(request({ action: "get", id }, "Bearer expired"))).status).toBe(401);
    expect((await gateway(request({ action: "get", id }, "Basic malformed"))).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts only strict v2 save documents and rejects malformed artboards before storage", async () => {
    const { gateway, execute } = setup();
    const page = createBlankDocument();
    const document = projectFromDocument(page);
    const save = (value: unknown, editKey = "ab".repeat(32)) =>
      gateway(request({ action: "save", id, document: value, editKey }));
    expect((await save(document)).status).toBe(200);
    execute.mockClear();
    for (const invalid of [
      page,
      {},
      { ...document, extra: true },
      { ...document, pages: [] },
      { ...document, pages: [document.pages[0], document.pages[0]] },
      { ...document, pages: [{ ...document.pages[0], description: null }] },
      {
        ...document,
        pages: Array.from({ length: 21 }, (_, index) => ({
          ...document.pages[0],
          id: `page-${index}`,
        })),
      },
    ])
      expect((await save(invalid)).status).toBe(400);
    expect((await save(document, "weak")).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["rename", "delete"] as const)(
    "validates %s revision/capability fields and ignores forged ownership",
    async (action) => {
      const { gateway, execute } = setup();
      const body =
        action === "rename"
          ? { action, id, editKey: null, revision: 1, title: "New title" }
          : { action, id, editKey: null, revision: 1 };
      expect((await gateway(request(body, "Bearer test-token"))).status).toBe(200);
      expect(execute).toHaveBeenCalledWith(body, "verified-firebase-uid");
      expect((await gateway(request({ ...body, revision: undefined }))).status).toBe(400);
      expect((await gateway(request({ ...body, owner_id: "forged" }))).status).toBe(400);
      expect((await gateway(request({ ...body, editKey: "invalid" }))).status).toBe(400);
      if (action === "rename") {
        expect((await gateway(request({ ...body, title: " " }))).status).toBe(400);
        expect((await gateway(request({ ...body, title: "x".repeat(121) }))).status).toBe(400);
      }
    },
  );

  it("blocks unauthorized origins, methods, and oversized/invalid requests", async () => {
    const { gateway, execute } = setup();
    expect(
      (await gateway(request({ action: "get", id }, undefined, "https://other.example.com")))
        .status,
    ).toBe(403);
    expect((await gateway(new Request("https://designs.example.com"))).status).toBe(405);
    expect(
      (
        await gateway(
          new Request("https://designs.example.com", { method: "POST", body: "invalid" }),
        )
      ).status,
    ).toBe(400);
    expect((await gateway(request("x".repeat(600_001)))).status).toBe(413);
    expect((await gateway(request({ action: "get", id: "../../private" }))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves conflict errors and sanitizes unexpected failures with explicit reporting", async () => {
    const { gateway, execute, reportError } = setup();
    execute.mockRejectedValueOnce(new DesignRequestError("Reload it or save a copy.", 409));
    expect((await gateway(request({ action: "get", id }))).status).toBe(409);
    execute.mockRejectedValueOnce(new Error("internal storage information"));
    const response = await gateway(request({ action: "get", id }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal storage information");
    expect(reportError).toHaveBeenCalledOnce();
  });

  it.each([600_000, 600_001])("enforces the exact HTTP byte limit at %i bytes", async (bytes) => {
    const { gateway, execute } = setup();
    const body = JSON.stringify({ action: "get", id }).padEnd(bytes, " ");
    const response = await gateway(
      new Request("https://designs.example.com", { method: "POST", body }),
    );
    expect(response.status).toBe(bytes <= 600_000 ? 200 : 413);
    expect(execute).toHaveBeenCalledTimes(bytes <= 600_000 ? 1 : 0);
  });
});
