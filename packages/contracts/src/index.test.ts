import { describe, expect, it } from "vitest";
import { EventPageSchema, EventQuerySchema } from "./index.js";

describe("event API contracts", () => {
  it("requires latitude and longitude together", () => {
    expect(EventQuerySchema.safeParse({ latitude: 41.88 }).success).toBe(false);
    expect(EventQuerySchema.safeParse({ longitude: -87.63 }).success).toBe(false);
    expect(EventQuerySchema.safeParse({ latitude: 41.88, longitude: -87.63 }).success).toBe(true);
  });

  it("accepts cursor-paginated event responses", () => {
    expect(EventPageSchema.safeParse({ events: [], count: 0, nextCursor: null }).success).toBe(true);
    expect(EventPageSchema.safeParse({ events: [], count: 0, nextCursor: "opaque" }).success).toBe(true);
  });
});
