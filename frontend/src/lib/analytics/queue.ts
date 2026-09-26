// Pre-init buffer. Events tracked before a provider is ready are held here
// (enriched, with their original timestamp) and replayed in order once the
// provider loads. Bounded so a provider that never loads can't grow memory.

import type { TrackPayload, UserTraits } from "./types";

export type QueuedOp =
  | { kind: "track"; payload: TrackPayload }
  | { kind: "identify"; userId: string; traits: UserTraits }
  | { kind: "reset"; newAnonymousId: string };

const MAX_QUEUE = 100;

export class OpQueue {
  private items: QueuedOp[] = [];
  dropped = 0;

  push(op: QueuedOp): void {
    if (this.items.length >= MAX_QUEUE) {
      this.items.shift();
      this.dropped += 1;
    }
    this.items.push(op);
  }

  drain(): QueuedOp[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}
