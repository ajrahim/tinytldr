import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChromiumRenderer } from "@tinytldr/renderer";
import { HostedArtifacts, type ArtifactStorage } from "./HostedArtifacts.js";

export class HostedRenderGate {
  private busy = false;

  acquire() {
    if (this.busy) throw new Error("Hosted renderer is busy. Retry shortly.");
    this.busy = true;
    return () => {
      this.busy = false;
    };
  }
}

export class HostedRequestScope {
  readonly controller = new AbortController();
  readonly renderer = new ChromiumRenderer(this.controller.signal);
  readonly artifacts: HostedArtifacts;
  private readonly pending = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;
  private rendererClosing: Promise<void> | undefined;

  private constructor(
    private readonly directory: string,
    uid: string,
    storage: ArtifactStorage,
    private readonly gate: HostedRenderGate,
    private readonly timeoutMs: number,
  ) {
    this.artifacts = new HostedArtifacts(directory, uid, storage, this.controller.signal);
  }

  static async create(
    uid: string,
    storage: ArtifactStorage,
    gate: HostedRenderGate,
    timeoutMs = 120_000,
  ) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-hosted-"));
    return new HostedRequestScope(directory, uid, storage, gate, timeoutMs);
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    this.controller.signal.throwIfAborted();
    const release = this.gate.acquire();
    const deadline = setTimeout(
      () => this.controller.abort(new Error("Hosted rendering exceeded its time limit.")),
      this.timeoutMs,
    );
    const work = (async () => {
      try {
        this.controller.signal.throwIfAborted();
        const result = await operation();
        this.controller.signal.throwIfAborted();
        return result;
      } finally {
        clearTimeout(deadline);
        release();
      }
    })();
    this.pending.add(work);
    void work.then(
      () => this.pending.delete(work),
      () => this.pending.delete(work),
    );
    return work;
  }

  close() {
    if (this.closing) return this.closing;
    this.controller.abort(new Error("MCP request closed."));
    this.closing = (async () => {
      try {
        try {
          await this.closeRenderer();
        } finally {
          await Promise.allSettled(this.pending);
        }
      } finally {
        await fs.rm(this.directory, { recursive: true, force: true });
      }
    })();
    return this.closing;
  }

  closeRenderer() {
    this.rendererClosing ??= this.renderer.close();
    return this.rendererClosing;
  }
}
