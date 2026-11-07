import { createHash } from "node:crypto";
import { z } from "zod";
import { AiContextSchema, WorkspaceProjectSchema } from "@tinytldr/core/ai";

type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>;
type AiContext = z.infer<typeof AiContextSchema>;

const rasterImageUrl = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}/g;
const imageReference = /tinytldr-image:[a-z0-9_-]+(?=$|\\?["']|[\s)>])/gi;

export class AiImageAssetError extends Error {}

export class AiImageAssets {
  private readonly sources = new Map<string, string>();
  readonly references: { name: string; source: string }[] = [];

  constructor(context: readonly AiContext[]) {
    for (const item of context) {
      if (item.kind !== "image") continue;
      const source = this.register(`data:${item.mimeType};base64,${item.base64}`);
      this.references.push({ name: item.name, source });
    }
  }

  private register(dataUrl: string): string {
    const reference = `tinytldr-image:${createHash("sha256").update(dataUrl).digest("hex")}`;
    this.sources.set(reference, dataUrl);
    return reference;
  }

  redact(project: WorkspaceProject): WorkspaceProject {
    const json = JSON.stringify(project).replace(rasterImageUrl, (dataUrl) => {
      const reference = this.register(dataUrl);
      if (!this.references.some((item) => item.source === reference))
        this.references.push({
          name: `Existing design image ${this.references.length + 1}`,
          source: reference,
        });
      return reference;
    });
    return WorkspaceProjectSchema.parse(JSON.parse(json));
  }

  resolve(project: WorkspaceProject): WorkspaceProject {
    const original = JSON.stringify(project);
    for (const match of original.matchAll(rasterImageUrl)) {
      const reference = `tinytldr-image:${createHash("sha256").update(match[0]).digest("hex")}`;
      if (!this.sources.has(reference))
        throw new AiImageAssetError(
          "The AI returned an unrecognized image instead of an attached image reference. Nothing was applied. Try again.",
        );
    }
    const json = original.replace(imageReference, (reference) => {
      const dataUrl = this.sources.get(reference);
      if (!dataUrl)
        throw new AiImageAssetError(
          "The AI referenced an unavailable image. Nothing was applied. Attach the image and try again.",
        );
      return dataUrl;
    });
    if (/tinytldr-image:/i.test(json))
      throw new AiImageAssetError(
        "The AI returned an invalid image reference. Nothing was applied. Try again.",
      );
    const checked = WorkspaceProjectSchema.safeParse(JSON.parse(json));
    if (!checked.success || Buffer.byteLength(json, "utf8") > 500_000)
      throw new AiImageAssetError(
        "The placed images exceed the design's size limits (400 KB document, 500 KB UTF-8 save). Use a smaller image and try again. Nothing was applied.",
      );
    return checked.data;
  }
}
