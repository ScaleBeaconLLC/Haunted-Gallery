import assert from "assert";
import { readFileSync } from "node:fs";
import { DOORWAYS, ROOMS, RoomId, frontOf, standingSpot } from "../src/game/data.js";
import { isWalkable, nearestWalkable, roomPath } from "../src/game/nav.js";

// Blender-built rooms: the furniture footprints the server walks around must be the ones the
// build script placed (it writes them next to the script), and the room must stay playable.
const BUILT: { room: RoomId; footprints: string }[] = [
  { room: "conservation", footprints: "../tools/blender/conservation_lab_obstacles.json" },
];

describe("Blender-built room data", () => {
  for (const { room, footprints } of BUILT) {
    const def = ROOMS[room];
    it(`${room}: obstacles match the model's footprints`, () => {
      const model = JSON.parse(readFileSync(new URL(footprints, new URL("../", import.meta.url)), "utf8"));
      assert.deepStrictEqual(def.obstacles, model);
    });
    it(`${room}: every doorway reaches every hiding place's approach and the open area`, () => {
      const doors = DOORWAYS.filter(d => d.room === room);
      assert.ok(doors.length > 0);
      for (const d of doors) {
        const inside = nearestWalkable(room, d.pos, 2.5);
        assert.ok(inside, `no floor inside door ${d.key}`);
        for (const h of def.hides) {
          const target = isWalkable(room, h.pos) ? h.pos : frontOf(h);
          assert.ok(isWalkable(room, target), `${h.id}: approach ${target} is not walkable`);
          assert.ok(roomPath(room, inside!, target), `${h.id}: no path from door ${d.key}`);
        }
        for (let i = 0; i < 16; i++) {
          const spot = standingSpot(room, i);
          assert.ok(isWalkable(room, spot), `arrival spot ${i} ${spot} is inside furniture`);
          assert.ok(roomPath(room, inside!, spot), `arrival spot ${i} unreachable from ${d.key}`);
        }
      }
    });
  }
});
