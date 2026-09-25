"""Engine-independent phone SOS privacy and rescue score rules for Project 6.

An Unreal adapter must supply real movement, line-of-sight and contact events.
This module only accepts those verified events; it never moves an actor itself.
"""
from dataclasses import dataclass
from project6_narrative import CAST, OpeningRole

ROOM_GRAPH = {
    "portrait": ("sculpture", "sealed"),
    "sculpture": ("portrait", "sealed", "study"),
    "archive": ("sealed", "conservation"),
    "conservation": ("archive", "sealed", "mirrors"),
    "study": ("sculpture", "sealed"),
    "sealed": ("portrait", "sculpture", "archive", "conservation", "study", "mirrors"),
    "mirrors": ("conservation", "sealed"),
}
SOS_PRESETS = {"come_get_me", "found_camera", "exit_blocked"}


@dataclass
class Guest:
    room: str
    status: str = "alive"
    score: int = 0


@dataclass
class HelpRequest:
    number: int
    sender: str
    recipient: str
    room_snapshot: str
    sent_turn: int
    preset: str
    accepted: bool = False


class RescueSession:
    def __init__(self, roles: OpeningRole):
        self.guests = {name: Guest("portrait") for name in roles.active_guests}
        self.guests[roles.birthday_guest] = Guest("portrait", "infected")
        self.guests["elias"] = Guest("portrait", "infected")
        self.turn = 0
        self.requests: list[HelpRequest] = []
        self.assists: dict[str, dict[str, str]] = {}
        self.rescue_paid: set[str] = set()
        self.camera_paid: set[str] = set()
        self.team_score = 0

    def request_help(self, sender: str, recipient: str, preset: str) -> HelpRequest:
        if sender == recipient or preset not in SOS_PRESETS:
            raise ValueError("Choose a living teammate and a preset request")
        if self.guests[sender].status != "alive" or self.guests[recipient].status != "alive":
            raise ValueError("Only living survivors can send or receive an SOS")
        if any(r.sender == sender and r.sent_turn == self.turn for r in self.requests):
            raise ValueError("One SOS per sender per choice window")
        request = HelpRequest(len(self.requests) + 1, sender, recipient,
                              self.guests[sender].room, self.turn, preset)
        self.requests.append(request)
        return request

    def private_view(self, viewer: str) -> dict:
        """Hunters see living identities, never survivor rooms or private SOS."""
        guest = self.guests.get(viewer)
        if guest is None:
            raise ValueError("Unknown guest")
        view = {"living": tuple(n for n in CAST if n in self.guests
                                 and self.guests[n].status == "alive")}
        if guest.status == "alive":
            view["own_room"] = guest.room
            view["messages"] = [r.__dict__.copy() for r in self.requests
                                if viewer in (r.sender, r.recipient)
                                and r.sent_turn >= self.turn - 1
                                and self.guests[r.sender].status == "alive"]
        return view

    def reply(self, recipient: str, number: int, accept: bool) -> None:
        request = next(r for r in self.requests if r.number == number)
        if request.recipient != recipient or self.guests[recipient].status != "alive":
            raise ValueError("This private request belongs to another guest")
        if request.sent_turn < self.turn - 1 or self.guests[request.sender].status != "alive":
            raise ValueError("This request has expired")
        request.accepted = bool(accept)

    def set_room_after_unreal_travel(self, guest: str, destination: str) -> None:
        if self.guests[guest].status != "alive":
            raise ValueError("Only living survivors can travel as survivors")
        if destination not in ROOM_GRAPH[self.guests[guest].room]:
            raise ValueError("Travel must follow a connected room doorway")
        self.guests[guest].room = destination

    def record_verified_assist(self, helper: str, victim: str, method: str,
                               photographer: str | None = None) -> None:
        """Call only after Unreal confirms the physical assist in the same room."""
        if method not in ("camera_stun", "door_release") or helper == victim:
            raise ValueError("Unsupported rescue evidence")
        if self.guests[helper].status != "alive" or self.guests[victim].status != "alive":
            raise ValueError("Both guests must be alive when help is given")
        if self.guests[helper].room != self.guests[victim].room:
            raise ValueError("A rescue requires co-location in the Unreal level")
        if method == "camera_stun":
            photographer = photographer or helper
            if (self.guests[photographer].status != "alive" or
                    self.guests[photographer].room != self.guests[victim].room):
                raise ValueError("The photographer must be present at the flash")
        self.assists.setdefault(victim, {"helper": helper, "method": method,
                                         "photographer": photographer or ""})

    def escape(self, guest: str) -> None:
        """Call only after the Unreal exit trigger verifies a living escape."""
        if self.guests[guest].status != "alive":
            raise ValueError("A guest cannot escape twice or after infection")
        self.guests[guest].status = "escaped"
        self.guests[guest].score += 100
        self.team_score += 100
        aid = self.assists.get(guest)
        if aid and guest not in self.rescue_paid:
            self.guests[aid["helper"]].score += 150
            self.team_score += 150
            self.rescue_paid.add(guest)
            if aid["method"] == "camera_stun" and guest not in self.camera_paid:
                self.guests[aid["photographer"]].score += 50
                self.camera_paid.add(guest)

    def infect(self, guest: str) -> None:
        if self.guests[guest].status != "alive":
            raise ValueError("Only a living guest can be infected")
        self.guests[guest].status = "infected"
        self.assists.pop(guest, None)

    def next_choice_window(self) -> None:
        self.turn += 1
