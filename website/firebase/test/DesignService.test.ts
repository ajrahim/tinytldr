import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getTemplateBundle, getTemplateDefaultSample } from "@tinytldr/templates";
import {
  projectFromDocument,
  WorkspaceDocumentSchema,
  SavedWorkspaceDesignSchema,
  SavedDesignVersionSchema,
  DesignVersionPageSchema,
  FirebaseDesignDeletionSchema,
  DesignFolderSchema,
  FirebaseDesignRequestSchema,
  type FirebaseDesignRequest,
} from "@tinytldr/core";
import { DesignService } from "../src/DesignService.js";
import { createDesignGateway } from "../src/DesignGateway.js";

const original = projectFromDocument(
  WorkspaceDocumentSchema.parse({
    version: 1,
    title: "Firebase test design",
    template: getTemplateBundle("quote-card"),
    data: getTemplateDefaultSample("quote-card"),
    size: "square",
    theme: "paper",
    tokenOverrides: {},
  }),
);
const KEY = "ab".repeat(32);
const PROJECT = "demo-tinytldr";

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  "Real Firestore and Auth emulator design operations",
  () => {
    const app = initializeApp({ projectId: PROJECT }, "firebase-design-tests");
    const db = getFirestore(app);
    const service = new DesignService(db);
    let id: string;
    let ownerToken: string;
    let ownerId: string;
    let otherId: string;

    beforeAll(async () => {
      const signUp = async () => {
        const response = await fetch(
          `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ returnSecureToken: true }),
          },
        );
        const data = z
          .object({ localId: z.string(), idToken: z.string() })
          .parse(await response.json());
        expect(response.ok).toBe(true);
        return data;
      };
      const owner = await signUp();
      ownerId = owner.localId;
      ownerToken = owner.idToken;
      otherId = (await signUp()).localId;
      expect((await getAuth(app).verifyIdToken(ownerToken)).uid).toBe(ownerId);
    });
    beforeEach(() => {
      id = randomUUID();
    });
    afterAll(async () => {
      await db.terminate();
      await deleteApp(app);
    });
    const create = () =>
      service.execute({ action: "save", id, document: original, editKey: KEY }, null);

    it("renames only the title, creates an immutable revision, and rejects stale names", async () => {
      await create();
      const renamed = SavedWorkspaceDesignSchema.parse(
        await service.execute(
          { action: "rename", id, editKey: KEY, revision: 1, title: "  New title  " },
          null,
        ),
      );
      expect(renamed.document).toEqual({ ...original, title: "New title" });
      expect(renamed.revision).toBe(2);
      expect(
        SavedDesignVersionSchema.parse(
          await service.execute({ action: "version", id, editKey: KEY, revision: 1 }, null),
        ).document,
      ).toEqual(original);
      await expect(
        service.execute(
          { action: "rename", id, editKey: KEY, revision: 1, title: "Stale title" },
          null,
        ),
      ).rejects.toThrow(/Rename refused/);
    });

    it.each(["rename", "delete"] as const)(
      "authorizes %s with the guest capability or actual owner only",
      async (action) => {
        await create();
        const request =
          action === "rename"
            ? { action, id, editKey: "cd".repeat(32), revision: 1, title: "Authorized" }
            : { action, id, editKey: "cd".repeat(32), revision: 1 };
        await expect(service.execute(request, null)).rejects.toThrow(/private/);
        await service.execute({ action: "claim", id, editKey: KEY }, ownerId);
        const ownedRequest = { ...request, editKey: KEY, revision: 2 };
        await expect(service.execute(ownedRequest, null)).rejects.toThrow(/private/);
        await expect(service.execute(ownedRequest, otherId)).rejects.toThrow(/private/);
        await service.execute({ ...ownedRequest, editKey: null }, ownerId);
      },
    );

    it("serializes rename and delete so stale deletion cannot erase a newer revision", async () => {
      await create();
      const results = await Promise.allSettled([
        service.execute(
          { action: "rename", id, editKey: KEY, revision: 1, title: "New revision" },
          null,
        ),
        service.execute({ action: "delete", id, editKey: KEY, revision: 1 }, null),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const snapshot = await db.collection("designs").doc(id).get();
      if (snapshot.get("deleted_at")) {
        expect((await snapshot.ref.collection("versions").get()).size).toBe(0);
      } else {
        expect(
          SavedWorkspaceDesignSchema.parse(await service.execute({ action: "get", id }, null))
            .document.title,
        ).toBe("New revision");
        expect((await snapshot.ref.collection("versions").get()).size).toBe(2);
      }
    });

    it("permanently deletes more than one write batch of versions, hides account entries, and blocks resurrection", async () => {
      await service.execute({ action: "save", id, editKey: KEY, document: original }, ownerId);
      const ref = db.collection("designs").doc(id);
      for (let start = 2; start <= 501; start += 250) {
        const batch = db.batch();
        for (let revision = start; revision < Math.min(start + 250, 502); revision++)
          batch.create(ref.collection("versions").doc(String(revision)), {
            design_id: id,
            revision,
            document_json: JSON.stringify(original),
            saved_at: new Date().toISOString(),
          });
        await batch.commit();
      }
      expect((await ref.collection("versions").get()).size).toBe(501);
      const deletion = { action: "delete" as const, id, editKey: null, revision: 1 };
      expect(FirebaseDesignDeletionSchema.parse(await service.execute(deletion, ownerId))).toEqual({
        id,
        deleted: true,
      });
      expect((await ref.collection("versions").get()).size).toBe(0);
      expect((await ref.get()).data()).not.toHaveProperty("document_json");
      expect(
        SavedWorkspaceDesignSchema.array()
          .parse(await service.execute({ action: "list" }, ownerId))
          .map((design) => design.id),
      ).not.toContain(id);
      await expect(service.execute({ action: "get", id }, null)).rejects.toThrow(/not found/);
      await expect(
        service.execute({ action: "version", id, editKey: null, revision: 1 }, ownerId),
      ).rejects.toThrow(/not found/);
      await expect(
        service.execute({ action: "versions", id, editKey: null }, ownerId),
      ).rejects.toThrow(/not found/);
      await expect(
        service.execute({ action: "save", id, editKey: KEY, document: original }, ownerId),
      ).rejects.toThrow(/not found/);
      await expect(
        service.execute(
          { action: "save", id, editKey: null, revision: 1, document: original },
          ownerId,
        ),
      ).rejects.toThrow(/not found/);
      await expect(service.execute({ action: "claim", id, editKey: KEY }, otherId)).rejects.toThrow(
        /not found/,
      );
      expect(await service.execute(deletion, ownerId)).toEqual({ id, deleted: true });
    });

    it("reports incomplete deletion rather than success and permits only an authorized cleanup retry", async () => {
      await create();
      const cleanup = vi
        .spyOn(db, "recursiveDelete")
        .mockRejectedValueOnce(new Error("private cleanup failure"));
      const reportError = vi.fn();
      const gateway = createDesignGateway({
        service,
        allowedOrigins: [],
        verifyUser: async () => null,
        reportError,
      });
      const request = { action: "delete" as const, id, editKey: KEY, revision: 1 };
      try {
        const response = await gateway(
          new Request("https://designs.test", { method: "POST", body: JSON.stringify(request) }),
        );
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain("private cleanup failure");
        expect(reportError).toHaveBeenCalledOnce();
        expect((await db.collection("designs").doc(id).collection("versions").get()).size).toBe(1);
        await expect(service.execute({ action: "get", id }, null)).rejects.toThrow(/not found/);
        await expect(
          service.execute({ ...request, editKey: "cd".repeat(32) }, null),
        ).rejects.toThrow(/private/);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(await service.execute(request, null)).toEqual({ id, deleted: true });
        expect((await db.collection("designs").doc(id).collection("versions").get()).size).toBe(0);
      } finally {
        cleanup.mockRestore();
      }
    });

    it("rejects claiming a stale revision without discarding the newer guest changes", async () => {
      await create();
      await service.execute(
        { action: "rename", id, editKey: KEY, revision: 1, title: "New guest title" },
        null,
      );
      await expect(
        service.execute({ action: "claim", id, editKey: KEY, revision: 1 }, ownerId),
      ).rejects.toThrow(/Claim refused/);
      const latest = SavedWorkspaceDesignSchema.parse(
        await service.execute({ action: "get", id }, null),
      );
      expect(latest.owner_id).toBeNull();
      expect(latest.document.title).toBe("New guest title");
      await service.execute({ action: "claim", id, editKey: KEY, revision: 2 }, ownerId);
    });

    it.each([500_000, 500_001])(
      "enforces the exact UTF-8 storage limit at %i bytes",
      async (bytes) => {
        const document = structuredClone(original);
        const page = document.pages[0]!;
        page.data.test = "";
        const remaining = bytes - Buffer.byteLength(JSON.stringify(document), "utf8");
        page.data.test = "\u4f60".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
        expect(Buffer.byteLength(JSON.stringify(document), "utf8")).toBe(bytes);
        const saved = service.execute({ action: "save", id, document, editKey: KEY }, null);
        if (bytes <= 500_000) {
          expect(SavedWorkspaceDesignSchema.parse(await saved).document).toEqual(document);
        } else {
          await expect(saved).rejects.toThrow(/500 KB in UTF-8/);
          expect((await db.collection("designs").doc(id).get()).exists).toBe(false);
        }
      },
    );

    it("saves public designs idempotently without leaking the guest key or its hash", async () => {
      const first = SavedWorkspaceDesignSchema.parse(await create());
      expect(await create()).toEqual(first);
      const publicResult = await service.execute({ action: "get", id }, null);
      expect(publicResult).toEqual(first);
      expect(JSON.stringify(publicResult)).not.toContain(KEY);
      expect(publicResult).not.toHaveProperty("guest_key_hash");
      expect(first.owner_id).toBeNull();
      await expect(
        service.execute({ action: "save", id, document: original, editKey: "cd".repeat(32) }, null),
      ).rejects.toThrow(/already in use/);
    });

    it("serializes competing saves and preserves immutable snapshots", async () => {
      await create();
      const results = await Promise.allSettled([
        service.execute(
          {
            action: "save",
            id,
            document: { ...original, title: "First edit" },
            revision: 1,
            editKey: KEY,
          },
          null,
        ),
        service.execute(
          {
            action: "save",
            id,
            document: { ...original, title: "Second edit" },
            revision: 1,
            editKey: KEY,
          },
          null,
        ),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const version = SavedDesignVersionSchema.parse(
        await service.execute({ action: "version", id, revision: 1, editKey: KEY }, null),
      );
      expect(version.document).toEqual(original);
      const current = SavedWorkspaceDesignSchema.parse(
        await service.execute({ action: "get", id }, null),
      );
      expect(current.revision).toBe(2);
    });

    it("preserves complete multi-page snapshots and restores old content only as a new revision", async () => {
      await create();
      const changed = structuredClone(original);
      changed.title = "Two pages";
      changed.pages.push({
        ...structuredClone(changed.pages[0]!),
        id: "evidence",
        title: "Evidence",
        description: "Explain the claim.",
      });
      changed.pages[1]!.template.stylesCss += "\nh1 { color: #123456; }";
      await service.execute(
        { action: "save", id, document: changed, revision: 1, editKey: KEY },
        null,
      );
      const version = (revision: number) =>
        service
          .execute({ action: "version", id, revision, editKey: KEY }, null)
          .then((result) => SavedDesignVersionSchema.parse(result));
      expect((await version(1)).document).toEqual(original);
      expect((await version(2)).document).toEqual(changed);
      const restored = SavedWorkspaceDesignSchema.parse(
        await service.execute(
          { action: "save", id, document: (await version(1)).document, revision: 2, editKey: KEY },
          null,
        ),
      );
      expect(restored.revision).toBe(3);
      expect(restored.document).toEqual(original);
      expect((await version(2)).document).toEqual(changed);
    });

    it("atomically consumes guest capabilities on claim and restricts editing/history to the owner", async () => {
      await create();
      const claims = await Promise.allSettled([
        service.execute({ action: "claim", id, editKey: KEY }, ownerId),
        service.execute({ action: "claim", id, editKey: KEY }, otherId),
      ]);
      expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const claimed = SavedWorkspaceDesignSchema.parse(
        await service.execute({ action: "get", id }, null),
      );
      expect(claimed.revision).toBe(2);
      expect((await db.collection("designs").doc(id).get()).get("guest_key_hash")).toBeNull();
      await expect(service.execute({ action: "versions", id, editKey: KEY }, null)).rejects.toThrow(
        /private/,
      );
      await expect(
        service.execute(
          { action: "save", id, document: original, revision: 2, editKey: KEY },
          null,
        ),
      ).rejects.toThrow(/private/);
      const history = DesignVersionPageSchema.parse(
        await service.execute({ action: "versions", id, editKey: null }, claimed.owner_id),
      );
      expect(history.versions.map((version) => version.revision)).toEqual([2, 1]);
      const nonOwner = claimed.owner_id === ownerId ? otherId : ownerId;
      await expect(
        service.execute({ action: "version", id, revision: 1, editKey: KEY }, nonOwner),
      ).rejects.toThrow(/private/);
      await expect(
        service.execute(
          { action: "save", id, revision: 2, document: original, editKey: KEY },
          nonOwner,
        ),
      ).rejects.toThrow(/private/);
    });

    it("retains over fifty snapshots, paginates without gaps or duplicates and keeps account lists owner-scoped", async () => {
      await service.execute({ action: "save", id, document: original, editKey: KEY }, ownerId);
      for (let revision = 1; revision < 54; revision++)
        await service.execute(
          {
            action: "save",
            id,
            document: { ...original, title: `Edit ${revision}` },
            revision,
            editKey: null,
          },
          ownerId,
        );
      const first = DesignVersionPageSchema.parse(
        await service.execute({ action: "versions", id, editKey: null }, ownerId),
      );
      expect(first.versions).toHaveLength(20);
      expect(first.next_before).toBe(35);
      const second = DesignVersionPageSchema.parse(
        await service.execute(
          { action: "versions", id, editKey: null, before: first.next_before! },
          ownerId,
        ),
      );
      expect(second.versions).toHaveLength(20);
      expect(second.next_before).toBe(15);
      const third = DesignVersionPageSchema.parse(
        await service.execute(
          { action: "versions", id, editKey: null, before: second.next_before! },
          ownerId,
        ),
      );
      expect(third.versions).toHaveLength(14);
      expect(third.next_before).toBeNull();
      expect(
        [...first.versions, ...second.versions, ...third.versions].map(
          (version) => version.revision,
        ),
      ).toEqual(Array.from({ length: 54 }, (_, index) => 54 - index));
      expect(first.versions[0]).not.toHaveProperty("document");
      expect(JSON.stringify(first)).not.toContain(KEY);
      const other = SavedWorkspaceDesignSchema.array().parse(
        await service.execute({ action: "list" }, otherId),
      );
      expect(other.map((design) => design.id)).not.toContain(id);
      const own = SavedWorkspaceDesignSchema.array().parse(
        await service.execute({ action: "list" }, ownerId),
      );
      expect(own.map((design) => design.id)).toContain(id);
      await expect(service.execute({ action: "list" }, null)).rejects.toThrow(/Sign in/);
    });

    it("verifies real emulator tokens at the gateway and denies direct Firestore access", async () => {
      await create();
      const gateway = createDesignGateway({
        service,
        allowedOrigins: ["https://site.example.com"],
        verifyUser: async (token) => (await getAuth(app).verifyIdToken(token)).uid,
        reportError: (error) => {
          throw error;
        },
      });
      const response = await gateway(
        new Request("https://designs.example.com", {
          method: "POST",
          headers: { Authorization: `Bearer ${ownerToken}`, Origin: "https://site.example.com" },
          body: JSON.stringify({ action: "claim", id, editKey: KEY }),
        }),
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data.owner_id).toBe(ownerId);
      const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/designs/${id}`;
      expect((await fetch(url)).status).toBe(403);
      expect(
        (await fetch(url, { headers: { Authorization: `Bearer ${ownerToken}` } })).status,
      ).toBe(403);
      expect(
        (
          await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ fields: {} }),
          })
        ).status,
      ).toBe(403);
    });

    it("keeps account folders private, idempotent, ordered, and free of deleted designs", async () => {
      const folderList = DesignFolderSchema.array();
      const run = (request: FirebaseDesignRequest, user: string | null = ownerId) =>
        service.execute(request, user);
      const createOwned = async () => {
        const designId = randomUUID();
        await run({ action: "save", id: designId, document: original, editKey: KEY });
        return designId;
      };
      const first = await createOwned();
      const second = await createOwned();
      const work = randomUUID();
      const archive = randomUUID();
      await expect(run({ action: "folders" }, null)).rejects.toMatchObject({ status: 401 });
      const created = DesignFolderSchema.parse(
        await run({ action: "createFolder", folderId: work, name: "  Work  " }),
      );
      expect(created).toMatchObject({ id: work, name: "Work", design_ids: [] });
      // Retrying the same client-generated folder ID does not duplicate it.
      expect(await run({ action: "createFolder", folderId: work, name: "Changed" })).toMatchObject({
        name: "Work",
      });
      await run({ action: "createFolder", folderId: archive, name: "archive" });
      await expect(
        run({ action: "renameFolder", folderId: work, name: "Mine" }, otherId),
      ).rejects.toMatchObject({ status: 403 });
      expect(await run({ action: "folders" }, otherId)).toEqual([]);

      await run({ action: "moveToFolder", id: first, folderId: work });
      await run({ action: "moveToFolder", id: second, folderId: work });
      let folders = folderList.parse(
        await run({ action: "moveToFolder", id: first, folderId: archive }),
      );
      expect(folders.map((folder) => [folder.name, folder.design_ids])).toEqual([
        ["archive", [first]],
        ["Work", [second]],
      ]);
      await expect(
        run({ action: "moveToFolder", id: first, folderId: randomUUID() }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        run({ action: "moveToFolder", id: first, folderId: work }, otherId),
      ).rejects.toMatchObject({ status: 403 });
      // A guest design cannot be filed until it is claimed.
      await create();
      await expect(run({ action: "moveToFolder", id, folderId: work })).rejects.toMatchObject({
        status: 403,
      });

      folders = folderList.parse(await run({ action: "moveToFolder", id: first, folderId: null }));
      expect(folders.find((folder) => folder.id === archive)!.design_ids).toEqual([]);
      const renamed = DesignFolderSchema.parse(
        await run({ action: "renameFolder", folderId: work, name: "Clients" }),
      );
      expect(renamed.name).toBe("Clients");
      const colored = DesignFolderSchema.parse(
        await run({ action: "colorFolder", folderId: work, color: "blue" }),
      );
      expect(colored).toMatchObject({ name: "Clients", color: "blue", design_ids: [second] });
      await expect(
        run({ action: "colorFolder", folderId: work, color: "red" }, otherId),
      ).rejects.toMatchObject({ status: 403 });
      const renamedColored = DesignFolderSchema.parse(
        await run({ action: "renameFolder", folderId: work, name: "Clients" }),
      );
      expect(renamedColored.color).toBe("blue");
      const cleared = DesignFolderSchema.parse(
        await run({ action: "colorFolder", folderId: work, color: null }),
      );
      expect("color" in cleared).toBe(false);
      expect(() =>
        FirebaseDesignRequestSchema.parse({ action: "colorFolder", folderId: work, color: "#fff" }),
      ).toThrow();

      const saved = SavedWorkspaceDesignSchema.parse(await run({ action: "get", id: second }));
      // Filing never creates a revision.
      expect(saved.revision).toBe(1);
      await run({ action: "delete", id: second, editKey: null, revision: 1 });
      folders = folderList.parse(await run({ action: "folders" }));
      expect(folders.find((folder) => folder.id === work)!.design_ids).toEqual([]);

      expect(await run({ action: "deleteFolder", folderId: work })).toEqual({
        id: work,
        deleted: true,
      });
      await expect(run({ action: "deleteFolder", folderId: work })).rejects.toMatchObject({
        status: 404,
      });
      expect(
        SavedWorkspaceDesignSchema.parse(await run({ action: "get", id: first })).revision,
      ).toBe(1);
      await run({ action: "deleteFolder", folderId: archive });
    });
  },
);
