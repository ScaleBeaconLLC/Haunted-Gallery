"""Physical event gate for the seven-room Project 6 map.

Call these methods from the PIE tick and collision handlers. The phone relay
must never call a confirm_* method directly. This file has not had a PIE run.
"""
from math import dist

from project6_hunt_contract import HIDES, Project6Hunt


class Project6UnrealEvents:
    def __init__(self, world, hunt: Project6Hunt, pawns: dict):
        import unreal

        self.ue = unreal
        self.world = world
        self.hunt = hunt
        self.pawns = pawns
        self.rooms = self._markers("P6_ROOM")
        self.hides = self._markers("P6_HIDE")
        self.camera = self._tagged("HG_HUNT_CAMERA")
        if set(self.rooms) != set(HIDES) or len(self.hides) != 14:
            raise RuntimeError("Load the seven-room map with 14 physical hiding markers")
        if len(self.camera) != 1 or not set(hunt.rescue.guests) <= set(pawns):
            raise RuntimeError("The cast and physical camera must exist before play")

    def _tagged(self, tag):
        return list(self.ue.GameplayStatics.get_all_actors_with_tag(self.world, tag))

    def _markers(self, tag):
        result = {}
        for actor in self._tagged(tag):
            name = actor.get_actor_label()
            if name.startswith("P6_Room_") and tag == "P6_ROOM":
                result[name.removeprefix("P6_Room_")] = actor
            elif name.startswith("P6_Hide_") and tag == "P6_HIDE":
                result[name.removeprefix("P6_Hide_")] = actor
        return result

    @staticmethod
    def _xyz(actor):
        p = actor.get_actor_location()
        return (p.x, p.y, p.z)

    def _near(self, a, b, radius):
        # XY confirms marker entry; Z prevents a pawn on another floor passing.
        x, y, z = self._xyz(a)
        u, v, w = self._xyz(b)
        return dist((x, y), (u, v)) <= radius and abs(z - w) <= 180

    def arrive(self, guest, room):
        if room not in self.rooms or not self._near(self.pawns[guest], self.rooms[room], 780):
            raise ValueError("Pawn has not physically entered the selected room")
        self.hunt.confirm_arrival(guest, room)

    def hide(self, guest, room, hide):
        if hide not in HIDES.get(room, ()): 
            raise ValueError("Unknown hiding place")
        marker = self.hides.get(f"{room}_{HIDES[room].index(hide) + 1}")
        if marker is None or not self._near(self.pawns[guest], marker, 140):
            raise ValueError("Pawn has not entered the hiding marker")
        self.hunt.confirm_hide(guest, hide)

    def _visible(self, hunter, guest, max_range=1250):
        a, b = self.pawns[hunter], self.pawns[guest]
        if dist(self._xyz(a), self._xyz(b)) > max_range:
            return False
        p, q = self._xyz(a), self._xyz(b)
        start = self.ue.Vector(p[0], p[1], p[2] + 45)
        end = self.ue.Vector(q[0], q[1], q[2] + 45)
        hit = self.ue.SystemLibrary.line_trace_single(
            self.world, start, end,
            self.ue.TraceTypeQuery.TRACE_TYPE_QUERY1, False,
            [a, b], self.ue.DrawDebugTrace.NONE, True)
        return hit is None

    def discover(self, guest, hunter, now):
        if not self._visible(hunter, guest):
            raise ValueError("The hunter cannot see the guest")
        self.hunt.confirm_discovery(guest, hunter, now)

    def search_hide(self, hunter, room, hide, now):
        if hide not in HIDES.get(room, ()):
            raise ValueError("Unknown hiding place")
        marker = self.hides.get(f"{room}_{HIDES[room].index(hide) + 1}")
        if marker is None or not self._near(self.pawns[hunter], marker, 180):
            raise ValueError("Hunter has not reached the hiding place")
        return self.hunt.confirm_hunter_search(hunter, room, hide, now)

    def pickup_camera(self, guest):
        pawn = self.pawns[guest]
        if not self._near(pawn, self.camera[0], 135):
            raise ValueError("Pawn has not touched the camera")
        self.hunt.confirm_camera_pickup(guest, self.hunt.rescue.guests[guest].room)

    def flash(self, guest, now, hunters):
        pawn = self.pawns[guest]
        p = self._xyz(pawn)
        facing = pawn.get_actor_forward_vector()
        for hunter in hunters:
            q = self._xyz(self.pawns[hunter])
            dx, dy = q[0] - p[0], q[1] - p[1]
            distance = max(1, dist(p, q))
            if (facing.x * dx + facing.y * dy) / distance < 0.7:
                raise ValueError("Hunter is outside the camera cone")
            if not self._visible(guest, hunter, 1100):
                raise ValueError("The camera has no sightline")
        self.hunt.confirm_flash(guest, now, tuple(hunters))

    def grab(self, guest, hunter, now):
        if not self._near(self.pawns[guest], self.pawns[hunter], 130):
            raise ValueError("No physical contact")
        self.hunt.confirm_grab(guest, hunter, now)

    def bite(self, guest, hunter, now):
        if not self._near(self.pawns[guest], self.pawns[hunter], 130):
            raise ValueError("The hunter lost contact")
        self.hunt.confirm_infection(guest, hunter, now)

    def escape(self, guest):
        exits = self._tagged("P6_EXIT")
        if not exits or not any(self._near(self.pawns[guest], exit_actor, 130)
                                for exit_actor in exits):
            raise ValueError("No verified Project 6 exit trigger contact")
        self.hunt.confirm_escape(guest)
