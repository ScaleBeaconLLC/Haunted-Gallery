"""Deterministic Project 6 role, opening and ending contracts.

Engine independent: Unreal's opening Sequencer and phone lobby must use the
same contract. This module does not claim that those integrations are finished.
"""
from dataclasses import dataclass
from typing import Iterable

CAST = (
    "julian", "anika", "marcus", "mei", "dev", "amara", "alex",
    "andre", "rafael", "simone", "owen", "tessa", "nia",
)


@dataclass(frozen=True)
class OpeningRole:
    active_guests: tuple[str, ...]
    birthday_guest: str
    photographer: str
    organizer: str
    curator: str = "elias"


def assign_opening_roles(
    active_guests: Iterable[str], photographer: str, organizer: str
) -> OpeningRole:
    active = tuple(active_guests)
    if len(active) != 12 or len(set(active)) != 12 or not set(active) <= set(CAST):
        raise ValueError("Assign exactly twelve distinct guests from the 13-person cast")
    if photographer not in active or organizer not in active:
        raise ValueError("The photographer and organizer must be arriving guests")
    birthday = (set(CAST) - set(active)).pop()
    return OpeningRole(active, birthday, photographer, organizer)


@dataclass(frozen=True)
class OpeningBeat:
    seconds: float
    event: str
    cast: tuple[str, ...]
    camera_room: str = "portrait"


def opening_beats(roles: OpeningRole) -> tuple[OpeningBeat, ...]:
    """One physical camera; the flash precedes the bite by five seconds."""
    return (
        OpeningBeat(0, "limousine_arrives", roles.active_guests),
        OpeningBeat(6, "birthday_guest_revealed_inside", (roles.birthday_guest,)),
        OpeningBeat(12, "organizer_guides_group_in", (roles.organizer,)),
        OpeningBeat(20, "elias_welcomes_guests", (roles.curator,)),
        OpeningBeat(35, "painting_unveiled", (roles.curator,)),
        OpeningBeat(55, "birthday_photo_and_flash", (roles.photographer, roles.birthday_guest)),
        OpeningBeat(55, "elias_frozen", (roles.curator,)),
        OpeningBeat(60, "elias_bites_birthday_guest", (roles.curator, roles.birthday_guest)),
        OpeningBeat(61, "camera_drops_batteries_intact", (roles.photographer,)),
        OpeningBeat(66, "birthday_guest_turns", (roles.birthday_guest,)),
        OpeningBeat(68, "security_lockdown", (roles.curator,)),
        OpeningBeat(72, "hunt_starts", roles.active_guests),
    )


def opening_terminal_state(roles: OpeningRole) -> dict:
    """Skipping animation and watching it must establish identical game state."""
    return {
        "survivors": roles.active_guests,
        "infected": (roles.curator, roles.birthday_guest),
        "camera": {"count": 1, "room": "portrait", "holder": None,
                   "batteries_intact": True, "ready_at": 0.0},
        "lockdown": True,
        "hunt_enabled": True,
    }


@dataclass(frozen=True)
class Ending:
    variant: str
    escaped: int
    infected: int
    trapped: int
    final_scare: str = "curator_silhouette_after_results"


def choose_ending(escaped: int, infected: int, trapped: int) -> Ending:
    """Counts cover the twelve active guests; the opening victim is separate."""
    counts = (escaped, infected, trapped)
    if any(type(n) is not int or n < 0 for n in counts) or sum(counts) != 12:
        raise ValueError("Ending counts must partition the twelve active guests")
    variant = "escape" if escaped == 12 else "loss" if escaped == 0 else "mixed"
    return Ending(variant, escaped, infected, trapped)
