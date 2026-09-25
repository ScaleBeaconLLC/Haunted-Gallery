import unittest

from project6_narrative import CAST, assign_opening_roles
from project6_hunt_contract import Project6Hunt


class HuntContractTests(unittest.TestCase):
    def make_hunt(self):
        return Project6Hunt(assign_opening_roles(CAST[:12], "julian", "anika"))

    def test_room_choices_only_commit_after_real_arrival(self):
        hunt = self.make_hunt()
        hunt.choose("julian", "move", "sculpture")
        with self.assertRaises(ValueError):
            hunt.choose("anika", "move", "mirrors")
        orders = hunt.start_travel()
        self.assertEqual(orders["julian"].destination, "sculpture")
        self.assertEqual(hunt.phone_view("julian")["own_room"], "portrait")
        with self.assertRaises(ValueError):
            hunt.confirm_arrival("julian", "sealed")
        hunt.confirm_arrival("julian", "sculpture")
        self.assertEqual(hunt.phone_view("julian")["own_room"], "sculpture")

    def test_two_distinct_hiding_places_and_private_location(self):
        hunt = self.make_hunt()
        hunt.choose("julian", "hide", hide="curtain_recess")
        hunt.start_travel()
        hunt.confirm_hide("julian", "curtain_recess")
        hunt.start_encounter()
        self.assertNotIn("own_room", hunt.phone_view("elias"))
        self.assertNotIn("messages", hunt.phone_view("elias"))
        self.assertNotIn("julian", hunt.confirm_hunter_search("elias", "portrait", "service_niche"))
        self.assertIn("julian", hunt.confirm_hunter_search("elias", "portrait", "curtain_recess"))

    def test_photo_rescue_and_escape_score_require_events(self):
        hunt = self.make_hunt()
        hunt.start_travel()
        hunt.start_encounter()
        hunt.confirm_camera_pickup("julian", "portrait")
        hunt.confirm_discovery("anika", "elias", 9)
        hunt.confirm_grab("anika", "elias", 9.5)
        hunt.confirm_flash("julian", 10, ("elias",))
        with self.assertRaises(ValueError):
            hunt.confirm_infection("anika", "elias", 11)
        with self.assertRaises(ValueError):
            hunt.confirm_infection("anika", "elias", 16)
        with self.assertRaises(ValueError):
            hunt.confirm_flash("julian", 11, ("elias",))
        hunt.rescue.record_verified_assist("julian", "anika", "camera_stun", "julian")
        self.assertEqual(hunt.results()["team_score"], 0)
        hunt.confirm_escape("anika")
        self.assertEqual(hunt.rescue.guests["julian"].score, 200)
        self.assertEqual(hunt.rescue.guests["anika"].score, 100)
        self.assertEqual(hunt.results()["team_score"], 250)

    def test_named_sos_is_private_to_sender_and_recipient(self):
        hunt = self.make_hunt()
        msg = hunt.send_sos("julian", "anika", "come_get_me")
        self.assertEqual(msg.room_snapshot, "portrait")
        self.assertEqual(len(hunt.phone_view("anika")["messages"]), 1)
        self.assertEqual(hunt.phone_view("marcus")["messages"], [])
        with self.assertRaises(ValueError):
            hunt.answer_sos("marcus", msg.number, True)
        hunt.answer_sos("anika", msg.number, True)
        self.assertEqual(hunt.results()["team_score"], 0)
        hunt.start_travel()
        with self.assertRaises(ValueError):
            hunt.send_sos("julian", "marcus", "come_get_me")

    def test_discovery_grab_bite_voices_follow_physical_events(self):
        hunt = self.make_hunt()
        hunt.start_travel()
        hunt.start_encounter()
        with self.assertRaises(ValueError):
            hunt.confirm_grab("anika", "elias", 1)
        hunt.confirm_discovery("anika", "elias", 2)
        hunt.confirm_discovery("anika", "elias", 2.5)
        hunt.confirm_discovery("anika", "nia", 2.6)
        hunt.confirm_grab("anika", "elias", 3)
        hunt.confirm_infection("anika", "elias", 4)
        cues = [(e["event"], e["voice"]) for e in hunt.events if "voice" in e]
        self.assertEqual(cues, [("discovery", "VO_anika_discovered_01"),
                                ("grabbed", "VO_anika_grabbed_01"),
                                ("bite", "VO_anika_bitten_01")])
        self.assertNotIn("messages", hunt.phone_view("anika"))

    def test_escape_requires_recovering_the_camera(self):
        hunt = self.make_hunt()
        hunt.start_travel()
        hunt.start_encounter()
        with self.assertRaises(ValueError):
            hunt.confirm_escape("julian")
        hunt.confirm_camera_pickup("julian", "portrait")
        hunt.confirm_escape("julian")
        self.assertEqual(hunt.results()["escaped"], 1)


if __name__ == "__main__":
    unittest.main()
