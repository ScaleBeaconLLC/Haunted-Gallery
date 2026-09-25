# Haunted Gallery — rescue and phone messages

**Project 6 gameplay contract, September 25, 2026.** Twelve active guests play on their phones while standing together in the real venue. Their characters occupy different rooms in the virtual mansion. The thirteenth, unselected guest is already inside and becomes the birthday victim. Any of the thirteen identities, including Nia, can be that victim. Elias is the Curator.

## The reason to stay

Escape alive is the personal objective. The shared objective is to get as many of the twelve active guests out as possible. Recover the **one working antique camera** because a deliberate photo freezes a visible infected hunter for five seconds; it recharges for seven seconds after the shutter. The camera is powerful protection for a rescue, not a required item for escape and not a way to kill Elias. It can fall, be picked up, passed, or leave with a survivor, but never duplicate.

The player with the camera faces a real choice: leave now and bank a personal escape, or use its next photo to buy time for someone else. A rescuer can also lead a guest through a safe route or help them past a jammed door when that interaction exists in the playable level. A rescue succeeds only when the threatened guest actually escapes, after an observable assist. Accepting a request alone earns nothing.

## Private SOS on the phone

1. While alive, a guest taps **Ask for help** and chooses one living guest. The game supplies the sender's character name, player display name, current verified room, and send time. The sender picks a short preset: “Come get me,” “I found the camera,” or “The exit is blocked.” No free-text or voice-chat system is required for the first release.
2. The recipient sees a private phone card, for example: **Nia (Jermell) needs help · Archive Library · just now.** Buttons: **I'm coming**, **I can't risk it**, **Open map**. Accepting never teleports the character or overrides a locked move.
3. A room on a message is a snapshot. If the sender moves, mark it **last seen**, and show a new location only after the sender deliberately updates the request. The game never fabricates a live tracking signal.
4. The recipient can choose an adjacent room in the next choice window, cross the real doorway in Unreal, and assist only when actually co-located. If the route takes several turns, the recipient sees the legal next step. Staying hidden or ignoring the message remains a valid choice.
5. Limit each sender to one active SOS per choice window, with a short cooldown and expiration. Cancel it on escape, infection, or a new match. A reply is private to the sender. Phone haptics and a brief visual alert suffice; do not speak the message aloud over the shared display.

The recipient knows who asked. People standing together may recognize the sender and react in person, which is part of the social tension. The game asks for less talking by making the phone the source of truth; live screams and spontaneous reactions in the room are welcome.

## What the zombies know

The Curator and infected players see the roster and who remains alive or escaped. They do not receive survivor SOS messages, current survivor room choices, hiding positions, or private reply state. Infected players keep their hunter role but cannot send a living-survivor SOS. A separate deception power could be designed later; base messages are authentic and game-verified. The audience display may show aggregate rescue and survival counts, never a private live room map or a named hiding place.

## Score that rewards rescue

| Event | Personal score | Team score | Award condition |
| --- | ---: | ---: | --- |
| Escape alive | +100 | +100 | Survivor reaches the exit alive. |
| Successful rescue | +150 to one lead rescuer | +150 | Actual co-located help, followed by that guest escaping; once per guest. |
| Camera assist | +50 to photographer | Included in rescue | A deliberate flash makes a hunter release or miss that guest and the guest later escapes; once per guest. |
| Recover camera | No standalone points | No standalone points | Recovering it creates an option, not an incentive to hoard it. |
| Accept or send SOS | 0 | 0 | No reward for notification spam or promises. |

The team score and escaped headcount are the main results. Personal hero points acknowledge risk but do not turn a selfish escape into the best possible result: escaping alone gives 100 personal / 100 team, while escaping after saving one guest can give 250 personal / 350 team before any camera assist. A player who dies after a genuine assist can still earn rescue credit if the guest escapes. The rescued guest keeps their own 100 escape points. Deduplicate lead rescuer and camera assist for each victim. These values are initial tuning numbers, subject to a real 12-player rehearsal.

## Example

Nia is alive in the Archive Library and privately pings Marcus. Marcus's phone shows Nia's name and the Archive as her **last confirmed room**. The shared screen and Elias do not show the ping. Marcus may stay hidden, move toward her over legal adjacent rooms, or take the camera and risk the rescue. If Marcus reaches her and a photo freezes Elias long enough for Nia to escape, Marcus receives rescue credit; Nia receives escape credit; the whole group gains another survivor. If Nia was the opening victim in this match, she is infected and cannot send that SOS, so another living guest fills the example.

## Implementation gate

Selection, phone delivery, adjacency travel, camera timing, bite interruption, co-location, genuine exit and score attribution must be connected in the same Unreal session before this is called playable. The project currently has a seven-room map framework and an engine-independent narrative contract; the full rescue loop is not yet verified in Unreal.
