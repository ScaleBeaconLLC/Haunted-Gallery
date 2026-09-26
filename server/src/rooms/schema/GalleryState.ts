import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Public, broadcast state only. Everything a phone may not share with every other
 * phone (rooms, hiding places, camera location, SOS, personal score) travels in
 * per-client "view" messages instead.
 */
export const Seat = schema({
  character: t.string(),
  displayName: t.string().default(""),
  taken: t.boolean().default(false),
  isCpu: t.boolean().default(false),
  connected: t.boolean().default(false),
  /** "" in the lobby, then "inside" or "escaped". Infection is secret and never appears here. */
  status: t.string().default(""),
  birthday: t.boolean().default(false),
});
export type Seat = SchemaType<typeof Seat>;

export const GalleryState = schema({
  joinCode: t.string().default(""),
  /** lobby | opening | hunt | ended */
  phase: t.string().default("lobby"),
  paused: t.boolean().default(false),
  /** Server epoch ms when the current phase ends (0 while paused or in the lobby). */
  phaseEndsAt: t.number().default(0),
  exitOpen: t.boolean().default(false),
  cpuFill: t.boolean().default(true),
  teamScore: t.number().default(0),
  escapedCount: t.number().default(0),
  /** Active guests still in the mansion (survivors and turned alike). */
  insideCount: t.number().default(0),
  humanCount: t.number().default(0),
  birthday: t.string().default(""),
  photographer: t.string().default(""),
  /** JSON of the public results, set only once the match has ended. */
  results: t.string().default(""),
  seats: t.map(Seat),
});
export type GalleryState = SchemaType<typeof GalleryState>;
