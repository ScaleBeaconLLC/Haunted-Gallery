# Previous implementation excerpts

These files preserve selected earlier code for Claude Code to inspect. They are **reference**, not a functioning PlayCanvas project or deployed Colyseus server. Read `../CLAUDE.md` and `../HANDOFF_STATUS.md` before porting logic.

- `rules/`: early Python story, rescue, game rules and Unreal event adapter; `test_project6_hunt_contract.py` tests the older prototype, not the new multiplayer game.
- `phone-prototype/`: selected React phone interface, controller service and database types from the old controller site. It targeted an older five-room Unreal build. Do not deploy its UI as the new guest game.
- `unreal-prototype/`: Unreal hunt and phone bridging logic for historical reference; Unreal APIs and assumptions need replacement in PlayCanvas and Colyseus.

If old code contradicts the seven-room design, use the explicit requirements in `../CLAUDE.md` and `../RESCUE_AND_SOS.md`. In particular, the camera is useful for rescue but is not a required exit key.
