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
  /** "" in the lobby, then alive | infected | escaped (publicly visible per the design). */
  status: t.string().default(""),
  birthday: t.boolean().default(false),
});
export type Seat = SchemaType<typeof Seat>;

export const GalleryState = schema({
  joinCode: t.string().default(""),
  /** lobby | opening | choice | travel | encounter | ended */
  phase: t.string().default("lobby"),
  paused: t.boolean().default(false),
  round: t.number().default(0),
  /** Server epoch ms when the current phase ends (0 while paused or in the lobby). */
  phaseEndsAt: t.number().default(0),
  exitOpen: t.boolean().default(false),
  cpuFill: t.boolean().default(true),
  teamScore: t.number().default(0),
  escapedCount: t.number().default(0),
  infectedCount: t.number().default(0),
  aliveCount: t.number().default(0),
  humanCount: t.number().default(0),
  birthday: t.string().default(""),
  photographer: t.string().default(""),
  /** JSON of the public results, set only once the match has ended. */
  results: t.string().default(""),
  seats: t.map(Seat),
});
export type GalleryState = SchemaType<typeof GalleryState>;
