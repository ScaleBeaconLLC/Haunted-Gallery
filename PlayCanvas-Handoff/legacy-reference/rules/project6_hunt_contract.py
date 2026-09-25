"""Authoritative Project 6 choices and phone state, pending Unreal evidence.

Unreal owns movement, collision, sight, animations, sounds, and exit triggers.
The adapter must report those physical events before this model changes rooms,
credits a rescue, infects someone, or records an escape.
"""
from dataclasses import dataclass

from project6_narrative import OpeningRole, choose_ending
from project6_rescue_rules import ROOM_GRAPH, RescueSession

HIDES = {
    "portrait": ("curtain_recess", "service_niche"),
    "sculpture": ("plinth_shadow", "shipping_screen"),
    "archive": ("reading_alcove", "rolling_shelf"),
    "conservation": ("cabinet_bay", "canvas_rack"),
    "study": ("bookcase_gap", "desk_drapery"),
    "sealed": ("crate_tunnel", "blackout_recess"),
    "mirrors": ("false_reflection", "velvet_pocket"),
}


@dataclass(frozen=True)
class Choice:
    action: str
    destination: str
    hide: str | None = None


class Project6Hunt:
    """Reject spoofed phone actions and commit only Unreal-confirmed events."""

    def __init__(self, roles: OpeningRole):
        self.roles = roles
        self.rescue = RescueSession(roles)
        self.phase = "choice"
        self.round = 1
        self.choices: dict[str, Choice] = {}
        self.hidden: dict[str, str] = {}
        self.last_hide: dict[str, str] = {}
        self.camera_owner: str | None = None
        self.camera_room = "portrait"
        self.camera_recovered = False
        self.camera_ready_at = 0.0
        self.stunned_until: dict[str, float] = {}
        self.discovered: set[tuple[str, str]] = set()
        self.grabbed: set[tuple[str, str]] = set()
        self.voice_played: set[tuple[str, str]] = set()
        self.events: list[dict] = []

    def _alive(self, guest: str) -> bool:
        return guest in self.roles.active_guests and self.rescue.guests[guest].status == "alive"

    def choose(self, guest: str, action: str, destination: str | None = None,
               hide: str | None = None) -> Choice:
        if self.phase != "choice" or not self._alive(guest):
            raise ValueError("Only a living survivor can make a choice now")
        room = self.rescue.guests[guest].room
        if action == "move":
            if destination not in ROOM_GRAPH[room] or hide is not None:
                raise ValueError("Choose one connected room")
            order = Choice("move", destination)
        elif action == "hide":
            if destination not in (None, room) or hide not in HIDES[room]:
                raise ValueError("Choose a hiding place in your current room")
            order = Choice("hide", room, hide)
        elif action == "stay":
            if destination not in (None, room) or hide is not None:
                raise ValueError("Stay does not select another room or a hiding place")
            order = Choice("stay", room)
        else:
            raise ValueError("Unknown survivor choice")
        self.choices[guest] = order
        return order

    def start_travel(self) -> dict[str, Choice]:
        if self.phase != "choice":
            raise ValueError("Choices are already locked")
        self.phase = "travel"
        # Missing choices leave the survivor where they are. No teleport occurs.
        return {g: self.choices.get(g, Choice("stay", self.rescue.guests[g].room))
                for g in self.roles.active_guests if self._alive(g)}

    def confirm_arrival(self, guest: str, destination: str) -> None:
        if self.phase != "travel" or not self._alive(guest):
            raise ValueError("No living survivor is traveling")
        order = self.choices.get(guest)
        if not order or order.action != "move" or destination != order.destination:
            raise ValueError("Unreal arrival must match the locked room choice")
        self.rescue.set_room_after_unreal_travel(guest, destination)
        self.hidden.pop(guest, None)
        self.events.append({"event": "arrive", "guest": guest, "room": destination})

    def confirm_hunter_arrival(self, hunter: str, destination: str) -> None:
        if self.phase != "travel" or hunter not in self.rescue.guests:
            raise ValueError("No infected hunter is traveling")
        actor = self.rescue.guests[hunter]
        if actor.status != "infected" or destination not in ROOM_GRAPH[actor.room]:
            raise ValueError("Hunter travel must follow a physical adjacent doorway")
        actor.room = destination
        self.events.append({"event": "hunter_arrive", "hunter": hunter,
                            "room": destination})

    def confirm_hide(self, guest: str, hide: str) -> None:
        if self.phase != "travel" or not self._alive(guest):
            raise ValueError("No living survivor can enter hiding now")
        order = self.choices.get(guest)
        if not order or order.action != "hide" or order.hide != hide:
            raise ValueError("Unreal hiding marker must match the locked choice")
        self.hidden[guest] = hide
        self.last_hide[guest] = hide
        self.events.append({"event": "hide", "guest": guest, "hide": hide})

    def start_encounter(self) -> None:
        if self.phase != "travel":
            raise ValueError("Encounter follows travel")
        self.phase = "encounter"

    def confirm_hunter_search(self, hunter: str, room: str,
                              hide: str | None = None, now: float = 0) -> tuple[str, ...]:
        if self.phase != "encounter" or hunter not in self.rescue.guests:
            raise ValueError("No hunter search is underway")
        if self.rescue.guests[hunter].status != "infected" or room not in ROOM_GRAPH:
            raise ValueError("Only a present infected hunter can search")
        if self.rescue.guests[hunter].room != room or hide not in HIDES[room]:
            raise ValueError("Search only the hunter's real room and a valid hiding marker")
        if now < self.stunned_until.get(hunter, 0):
            raise ValueError("A stunned hunter cannot search")
        found = tuple(g for g in self.roles.active_guests if self._alive(g)
                      and self.rescue.guests[g].room == room
                      and self.hidden.get(g) == hide)
        for guest in found:
            self.hidden.pop(guest, None)
            self._discover(guest, hunter)
        self.events.append({"event": "search", "hunter": hunter, "room": room,
                            "hide": hide, "found": found})
        return found

    def _discover(self, guest: str, hunter: str) -> None:
        if (guest, hunter) not in self.discovered:
            self.discovered.add((guest, hunter))
            if (guest, "discovery") not in self.voice_played:
                self.voice_played.add((guest, "discovery"))
                # Unreal plays these only for characters actually present in the room.
                self.events.append({"event": "discovery", "guest": guest,
                                    "hunter": hunter, "voice": f"VO_{guest}_discovered_01",
                                    "sound": "zombie_discovery"})

    def confirm_discovery(self, guest: str, hunter: str, now: float) -> None:
        """Call only after an Unreal sight trace sees the exposed guest."""
        if (self.phase != "encounter" or not self._alive(guest)
                or hunter not in self.rescue.guests
                or self.rescue.guests[hunter].status != "infected"
                or self.rescue.guests[hunter].room != self.rescue.guests[guest].room
                or guest in self.hidden or now < self.stunned_until.get(hunter, 0)):
            raise ValueError("Discovery requires an unobstructed, active hunter in the same room")
        self._discover(guest, hunter)

    def confirm_grab(self, guest: str, hunter: str, now: float) -> None:
        """Call only after Unreal confirms capsule contact and a successful grab."""
        if (self.phase != "encounter" or not self._alive(guest)
                or (guest, hunter) not in self.discovered or guest in self.hidden
                or self.rescue.guests[hunter].room != self.rescue.guests[guest].room
                or now < self.stunned_until.get(hunter, 0)):
            raise ValueError("Grab requires discovery, contact and an unstunned hunter")
        if (guest, hunter) not in self.grabbed:
            self.grabbed.add((guest, hunter))
            if (guest, "grabbed") not in self.voice_played:
                self.voice_played.add((guest, "grabbed"))
                self.events.append({"event": "grabbed", "guest": guest,
                                    "hunter": hunter, "voice": f"VO_{guest}_grabbed_01"})

    def confirm_camera_pickup(self, guest: str, room: str) -> None:
        if not self._alive(guest) or self.camera_owner is not None:
            raise ValueError("Camera is not available")
        if self.camera_room != room or self.rescue.guests[guest].room != room:
            raise ValueError("Unreal must confirm a pickup at the camera's position")
        self.camera_owner, self.camera_room = guest, ""
        self.camera_recovered = True
        self.events.append({"event": "camera_pickup", "guest": guest})

    def confirm_flash(self, guest: str, now: float, visible_hunters: tuple[str, ...]) -> None:
        if self.phase != "encounter" or guest != self.camera_owner or not self._alive(guest):
            raise ValueError("Only the living camera holder can take a photo")
        if now < self.camera_ready_at or not visible_hunters:
            raise ValueError("The camera is charging or the shot has no visible threat")
        room = self.rescue.guests[guest].room
        if len(set(visible_hunters)) != len(visible_hunters) or any(
            h not in self.rescue.guests or self.rescue.guests[h].status != "infected"
            or self.rescue.guests[h].room != room for h in visible_hunters
        ):
            raise ValueError("Unreal must provide visible infected targets in this room")
        self.stunned_until.update({h: now + 5 for h in visible_hunters})
        self.grabbed = {pair for pair in self.grabbed if pair[1] not in visible_hunters}
        self.camera_ready_at = now + 7
        self.events.append({"event": "flash", "guest": guest, "targets": visible_hunters})

    def confirm_infection(self, guest: str, hunter: str, now: float) -> None:
        if self.phase != "encounter" or not self._alive(guest):
            raise ValueError("The victim must be alive in the encounter")
        if (hunter not in self.rescue.guests or (guest, hunter) not in self.grabbed
                or self.rescue.guests[hunter].status != "infected"
                or self.rescue.guests[hunter].room != self.rescue.guests[guest].room
                or self.stunned_until.get(hunter, 0) > now):
            raise ValueError("The attacking hunter must be present and able to bite")
        self.rescue.infect(guest)
        self.hidden.pop(guest, None)
        if self.camera_owner == guest:
            self.camera_owner, self.camera_room = None, self.rescue.guests[guest].room
        self.events.append({"event": "infection", "guest": guest, "hunter": hunter})
        self.events.append({"event": "bite", "guest": guest,
                            "hunter": hunter, "voice": f"VO_{guest}_bitten_01"})
        self.discovered = {pair for pair in self.discovered if pair[0] != guest}
        self.grabbed = {pair for pair in self.grabbed if pair[0] != guest}

    def confirm_escape(self, guest: str) -> None:
        if self.phase != "encounter" or not self._alive(guest):
            raise ValueError("Only a living survivor can escape")
        if not self.camera_recovered:
            raise ValueError("The team must recover the camera to unlock the exit")
        self.rescue.escape(guest)
        self.hidden.pop(guest, None)
        self.events.append({"event": "escape", "guest": guest})

    def next_round(self) -> None:
        if self.phase != "encounter":
            raise ValueError("Finish the encounter first")
        self.phase, self.round = "choice", self.round + 1
        self.choices.clear()
        self.hidden.clear()
        self.discovered.clear()
        self.grabbed.clear()
        self.voice_played.clear()
        self.rescue.next_choice_window()

    def send_sos(self, sender: str, recipient: str, preset: str):
        if self.phase != "choice" or sender not in self.roles.active_guests:
            raise ValueError("Only a survivor in the choice window can request help")
        return self.rescue.request_help(sender, recipient, preset)

    def answer_sos(self, recipient: str, number: int, accept: bool) -> None:
        if self.phase != "choice" or recipient not in self.roles.active_guests:
            raise ValueError("Only a survivor in the choice window can answer")
        self.rescue.reply(recipient, number, accept)

    def phone_view(self, guest: str) -> dict:
        private = self.rescue.private_view(guest)
        if guest in self.roles.active_guests and self._alive(guest):
            private.update({"phase": self.phase, "round": self.round,
                            "hiding": self.hidden.get(guest),
                            "camera": self.camera_owner == guest,
                            "options": ROOM_GRAPH[self.rescue.guests[guest].room]})
        return private

    def results(self) -> dict:
        statuses = [self.rescue.guests[g].status for g in self.roles.active_guests]
        escaped = statuses.count("escaped")
        infected = statuses.count("infected")
        trapped = 12 - escaped - infected
        ending = choose_ending(escaped, infected, trapped)
        return {"ending": ending.variant, "escaped": escaped,
                "infected": infected, "trapped": trapped,
                "team_score": self.rescue.team_score,
                "scores": {g: self.rescue.guests[g].score for g in self.roles.active_guests}}
