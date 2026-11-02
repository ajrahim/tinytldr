import { describe, expect, it } from "vitest";
import {
  WorkspaceDocumentSchema,
  WorkspaceProjectSchema,
  projectFromDocument,
} from "@tinytldr/core";
import { createBlankDocument } from "../src/lib/WorkspaceTemplates.js";
import {
  DESIGN_HISTORY_KEY,
  forgetLocalDesign,
  readDesignHistory,
  rememberLocalDesign,
  renameLocalDesign,
} from "../src/lib/DesignHistory.js";

const ID = "d5387401-7e05-468c-8a65-4b475dd91537";
const KEY = "ab".repeat(32);
const page = createBlankDocument();
const doc = projectFromDocument(page);

describe("Guest design history and strict v2 document boundaries", () => {
  function storage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
      clear: () => map.clear(),
      key: (index) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  }
  it("renames the latest local recovery without replacing raw sources, capabilities, or other drafts", () => {
    const store = storage();
    const entry = {
      id: ID,
      editKey: KEY,
      saved: true,
      revision: 2,
      updatedAt: new Date().toISOString(),
      document: doc,
      pageJson: { "page-1": "{ unfinished JSON" },
    };
    rememberLocalDesign(store, entry);
    const otherId = crypto.randomUUID();
    rememberLocalDesign(store, { ...entry, id: otherId });
    const renamed = renameLocalDesign(store, ID, "Renamed recovery", 3).find(
      (design) => design.id === ID,
    )!;
    expect(renamed.document).toEqual({ ...entry.document, title: "Renamed recovery" });
    expect(renamed.pageJson).toEqual(entry.pageJson);
    expect(renamed.editKey).toBe(KEY);
    expect(renamed.revision).toBe(3);
    expect(readDesignHistory(store).find((design) => design.id === otherId)?.document).toEqual(
      entry.document,
    );
    const before = store.getItem(DESIGN_HISTORY_KEY);
    expect(() => renameLocalDesign(store, ID, "Stale name", 2)).toThrow(/newer browser revision/);
    expect(store.getItem(DESIGN_HISTORY_KEY)).toBe(before);
    expect(() => renameLocalDesign(store, crypto.randomUUID(), "Missing")).toThrow(/removed/);
  });
  it("round trips full custom sources, private keys and links, deduplicates history, and removes a claimed design", () => {
    const store = storage();
    const entry = {
      id: ID,
      editKey: KEY,
      saved: true,
      revision: 1,
      updatedAt: new Date().toISOString(),
      document: doc,
    };
    rememberLocalDesign(store, entry);
    rememberLocalDesign(store, { ...entry, document: { ...doc, title: "Changed" } });
    expect(readDesignHistory(store)).toHaveLength(1);
    expect(readDesignHistory(store)[0]?.document.pages[0]?.template).toEqual(page.template);
    expect(forgetLocalDesign(store, ID)).toEqual([]);
    expect(readDesignHistory(store)).toEqual([]);
  });
  it("does not overwrite corrupt history or conceal storage failures", () => {
    const store = storage();
    store.setItem(DESIGN_HISTORY_KEY, "{broken");
    const entry = {
      id: ID,
      editKey: KEY,
      saved: false,
      updatedAt: new Date().toISOString(),
      document: doc,
    };
    expect(() => readDesignHistory(store)).toThrow();
    expect(() => rememberLocalDesign(store, entry)).toThrow();
    expect(store.getItem(DESIGN_HISTORY_KEY)).toBe("{broken");
    store.setItem = () => {
      throw new Error("Quota exceeded");
    };
    store.removeItem(DESIGN_HISTORY_KEY);
    expect(() => rememberLocalDesign(store, entry)).toThrow(/Quota/);
  });
  it("validates per-page sources, dimensions, theme and size budgets without accepting v1 workspace inputs", () => {
    expect(WorkspaceDocumentSchema.parse(page).template.manifest.license).toBe("MIT");
    expect(WorkspaceProjectSchema.safeParse(page).success).toBe(false);
    expect(
      WorkspaceDocumentSchema.safeParse({ ...page, size: { width: 0, height: 1080 } }).success,
    ).toBe(false);
    expect(WorkspaceDocumentSchema.safeParse({ ...page, theme: "missing" }).success).toBe(false);
    expect(
      WorkspaceDocumentSchema.safeParse({
        ...page,
        template: { ...page.template, stylesCss: "x".repeat(100_001) },
      }).success,
    ).toBe(false);
  });
  it("preserves unfinished titles, dimensions and markup in v2 recovery drafts without relaxing saved documents", () => {
    const draft = structuredClone(doc);
    draft.title = "";
    draft.size = { width: 0, height: 1080 };
    draft.pages[0]!.template.liquidTemplate = "";
    const store = storage();
    rememberLocalDesign(store, {
      id: ID,
      editKey: KEY,
      saved: false,
      updatedAt: new Date().toISOString(),
      document: draft,
    });
    expect(readDesignHistory(store)[0]?.document).toEqual(draft);
    expect(WorkspaceProjectSchema.safeParse(draft).success).toBe(false);
  });
  it("rejects v1 recovery documents instead of upgrading them", () => {
    const store = storage();
    const entry = {
      id: ID,
      editKey: KEY,
      saved: false,
      updatedAt: new Date().toISOString(),
      document: page,
    };
    store.setItem(DESIGN_HISTORY_KEY, JSON.stringify([entry]));
    expect(() => readDesignHistory(store)).toThrow();
    expect(store.getItem(DESIGN_HISTORY_KEY)).toBe(JSON.stringify([entry]));
  });
  it.each([{ schemaText: "{}" }, { templateJson: "{}" }, { templateJsonVersion: 2 }])(
    "rejects obsolete recovery fields without overwriting storage: %o",
    (obsolete) => {
      const store = storage();
      const raw = JSON.stringify([
        {
          id: ID,
          editKey: KEY,
          saved: false,
          updatedAt: new Date().toISOString(),
          document: doc,
          ...obsolete,
        },
      ]);
      store.setItem(DESIGN_HISTORY_KEY, raw);
      expect(() => readDesignHistory(store)).toThrow();
      expect(store.getItem(DESIGN_HISTORY_KEY)).toBe(raw);
    },
  );
});
