# Haunted Gallery — Project 6 AI voice direction

Decision, 25 September 2026: use distinct Inworld TTS-2 AI voices for all thirteen guests and Elias. No actor casting, hiring, or human recording is part of Project 6. The initial Dev, Amara and Marcus auditions failed the dramatic delivery check; they are timing references only. A new generation is approved only after the spoken panic is loud, broken, and different from the preceding whisper.

## Generate the turn as separate files

For each guest, render `hiding`, `discovered`, `grabbed`, `bitten`, `aftermath` and `distant_scream` as independent mono WAVs, with at least two useful variations of each important reaction. Use the model `inworld-tts-2`, Creative delivery, and 48 kHz mono WAV. Do not send one whole encounter in a single synthesis request: the model smooths the switch, and the game must interrupt speech at grab and bite. Give each line its own style tag and punctuation. `[scream]` steers spoken words; `[shriek]`, `[gasp]`, `[pant]`, `[grunt]`, `[groan]`, and `[growl]` can render one nonverbal sound. Reject any generated cry that sounds synthetic or comic. A licensed/recorded bite, fabric and body Foley remains separate from the voices.

At mix time, keep whispers much lower than projected discovery cries. Set safe output limits at the bus and preserve the contrast with automation; raising an evenly spoken sample will not create panic. Trigger `discovered` at the first true visual reveal, interrupt on grab, trigger the pain take at the bite frame, then allow shaken breath and silence before a restrained infected growl. Reverb, distance and wall occlusion happen in Unreal. The selected birthday guest and photographer can be any guest, so every guest voice needs those dynamic opening lines.

| Character / voice | Quiet diction | Discovery diction and text | Grab/bite diction |
| --- | --- | --- | --- |
| Julian Mercer / Blake | Measured, crisp: “Somebody's in here.” | A catch of air; clipped, projected “Back! BACK!” | Low rough “Get off!” breaks into a short cry. |
| Anika Rao / Eleanor | Firm and economical: “Wait. Don't open it.” | Small unbelieving “No”; higher, much louder “NO!” | “Don't touch me!” splits during contact. |
| Marcus Bell / Jason | Guarded: “Stay where I can see you.” | Hard chest-voiced “Get OFF me!” stressing OFF. | A grunt, then a brief cut-short pain cry. |
| Mei Chen / Hana | Deliberate near-whisper: “Stay low.” | Gasp, then piercing “NO!” | “Move!” is swallowed by the grab. |
| Dev Patel / Aarav | Fast nervous murmur: “It's outside the door.” | “No, no—AH! Get away from me!” AH must burst above the words. | “No” repeats faster, last one cut by bite. |
| Amara Okafor / Luna | Low listening voice: “I hear it breathing.” | Frozen beat, then “Oh my GOD! HELP!” with a loud crack on GOD. | Shout thins into breath and sudden pain. |
| Alex Park / Nate | Thin fast mutter: “I swear I saw something.” | Explosive “Shit!” then uneven “No, no, no!” | One strained “Wait!” and breath. |
| Andre Calder / Mark | Protective control: “Stay behind me.” | Command first: “RUN!” Fear follows only when cornered. | “Get OFF!” drops low before the cry. |
| Rafael Duarte / Simon | Smooth reassurance: “Just keep moving.” | Words tumble: “No! Don't—get OFF!” | The confident rhythm collapses into a gasp. |
| Simone Whitaker / Sarah | Hushed plea: “Please don't see me.” | Thin “No,” then a loud “NO—” and a short `[shriek]`. | Cry cuts off at bite. |
| Owen Price / Clive | Restrained measured warning: “Quiet. Wait.” | Abrupt “MOVE! NOW!” rather than a long shriek. | Muffled struggle and one pain yell. |
| Tessa Monroe / Ashley | Breath-led warning: “It's coming closer.” | “Oh my GOD—NO!” rises and cracks on NO. | Reaches for help, phrase breaks into a cry. |
| Nia Calder / Olivia | Clear grounded direction: “Through that door.” | Shouts useful information: “Andre! MOVE!” | If grabbed, “Get off me!” becomes personal and uncontrolled. |
| Elias Voss / Hades | Warm, composed welcome before flash. | After infection, no long dialogue; use breath and restrained growl. | Keep the Curator's identity recognizable. |

Use the identities to differentiate pacing, hesitation, word stress, breath and emotional trajectory; do not infer accents from names. Never let every character shout identical lines on the same beat. Keep subtitles for words and a concise `[screams]` cue. Acceptance requires listening to each finished WAV and to the spatialized in-game event, confirming the scream is unmistakably louder and less controlled than that character's warning.
