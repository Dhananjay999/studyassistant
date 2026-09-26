// Pre-init buffer. Ops that reach a provider before it is ready (identify /
// reset, or track batches released by the outbox) are held here in order and
// replayed once the provider loads. Bounded so a provider that never loads
// can't grow memory. Track events are normally held back in the persistent
// outbox until a provider is ready, so this mostly carries identify/reset.

import type { TrackPayload, UserTraits } from "./types";

export type QueuedOp =
  | { kind: "track"; payload: TrackPayload }
  | { kind: "identify"; userId: string; traits: UserTraits }
  | { kind: "reset"; newAnonymousId: string };

const MAX_QUEUE = 500;

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
