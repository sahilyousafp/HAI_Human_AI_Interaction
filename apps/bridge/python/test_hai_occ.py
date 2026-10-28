"""Tests for hai_occ. Needs OpenCascade (`cadquery-ocp`); the bridge's test suite runs this file with the interpreter it
finds that can import OCP, and skips it when none can.

    python -m unittest test_hai_occ
"""
import json
import math
import os
import tempfile
import unittest

import hai_occ


def square(size, z=0.0, cx=0.0, cy=0.0):
    h = size / 2
    return {"points": [[cx - h, cy - h, z], [cx + h, cy - h, z], [cx + h, cy + h, z], [cx - h, cy + h, z]], "closed": True}


def solid(x0, y0, x1, y1, z0, z1):
    return {"outline": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], "z0": z0, "z1": z1}


def make(request):
    with tempfile.TemporaryDirectory() as folder:
        source, target = os.path.join(folder, "request.json"), os.path.join(folder, "result.json")
        with open(source, "w", encoding="utf-8") as handle:
            json.dump(request, handle)
        summary = hai_occ.run(source, target)
        with open(target, encoding="utf-8") as handle:
            return summary, json.load(handle)


def bounds(part):
    p = part["positions"]
    return [(min(p[k::3]), max(p[k::3])) for k in range(3)]


class Boolean(unittest.TestCase):
    def test_union_of_overlapping_boxes(self):
        summary, answer = make(
            {"recipe": "boolean", "op": "union", "a": [solid(0, 0, 1000, 1000, 0, 1000)], "b": [solid(500, 0, 1500, 1000, 0, 1000)]}
        )
        self.assertTrue(summary["ok"] and answer["valid"])
        self.assertAlmostEqual(answer["volume"], 1.5e9, delta=1e3)

    def test_difference_cuts_a_notch(self):
        _, answer = make(
            {"recipe": "boolean", "op": "difference", "a": [solid(0, 0, 1000, 1000, 0, 1000)], "b": [solid(0, 0, 500, 500, 0, 1000)]}
        )
        self.assertAlmostEqual(answer["volume"], 0.75e9, delta=1e3)

    def test_intersection_keeps_the_overlap(self):
        _, answer = make(
            {"recipe": "boolean", "op": "intersection", "a": [solid(0, 0, 1000, 1000, 0, 1000)], "b": [solid(500, 500, 1500, 1500, 0, 1000)]}
        )
        self.assertAlmostEqual(answer["volume"], 0.25e9, delta=1e3)

    def test_a_group_is_fused_first(self):
        _, answer = make(
            {
                "recipe": "boolean",
                "op": "difference",
                "a": [solid(0, 0, 1000, 1000, 0, 1000), solid(1000, 0, 2000, 1000, 0, 1000)],
                "b": [solid(0, 0, 2000, 1000, 500, 1000)],
            }
        )
        self.assertAlmostEqual(answer["volume"], 1e9, delta=1e3)

    def test_the_mesh_is_a_closed_outward_surface(self):
        _, answer = make(
            {"recipe": "boolean", "op": "union", "a": [solid(0, 0, 1000, 1000, 0, 1000)], "b": [solid(2000, 0, 3000, 1000, 0, 1000)]}
        )
        part = answer["parts"][0]
        p, t = part["positions"], part["indices"]
        signed = 0.0
        for i in range(0, len(t), 3):
            a, b, c = ([p[3 * t[i + k] + j] for j in range(3)] for k in range(3))
            signed += (
                a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
            ) / 6
        self.assertAlmostEqual(signed, 2e9, delta=1e5)

    def test_a_bad_operation_is_a_clear_error(self):
        summary, _ = make({"recipe": "boolean", "op": "xor", "a": [], "b": []})
        self.assertFalse(summary["ok"])
        self.assertIn("union, difference or intersection", summary["error"])


class Loft(unittest.TestCase):
    def test_two_squares_make_a_frustum(self):
        _, answer = make({"recipe": "loft", "sections": [square(1000), square(500, z=1000)], "ruled": True})
        self.assertTrue(answer["valid"])
        frustum = 1000 / 3 * (1e6 + 250e3 + math.sqrt(1e6 * 250e3))
        self.assertAlmostEqual(answer["volume"], frustum, delta=frustum * 1e-6)
        self.assertEqual(bounds(answer["parts"][0])[2], (0.0, 1000.0))

    def test_three_sections_blend_smoothly(self):
        _, answer = make({"recipe": "loft", "sections": [square(1000), square(600, z=500), square(1000, z=1000)]})
        self.assertTrue(answer["ok"] and answer["valid"])
        self.assertLess(answer["volume"], 1e9)
        self.assertGreater(answer["volume"], 0.36e9)

    def test_one_section_is_refused(self):
        summary, _ = make({"recipe": "loft", "sections": [square(1000)]})
        self.assertFalse(summary["ok"])
        self.assertIn("at least 2 sections", summary["error"])

    def test_mixed_open_and_closed_is_refused(self):
        open_line = {"points": [[0, 0, 0], [1000, 0, 0]], "closed": False}
        summary, _ = make({"recipe": "loft", "sections": [square(1000), open_line]})
        self.assertFalse(summary["ok"])


class Sweep(unittest.TestCase):
    def test_a_square_along_a_straight_rail(self):
        rail = {"points": [[0, 0, 0], [0, 0, 3000]], "closed": False}
        _, answer = make({"recipe": "sweep", "profile": square(200), "rail": rail})
        self.assertTrue(answer["valid"])
        self.assertAlmostEqual(answer["volume"], 200 * 200 * 3000, delta=1e3)

    def test_a_bent_rail_keeps_the_section(self):
        rail = {"points": [[0, 0, 0], [0, 0, 2000], [2000, 0, 2000]], "closed": False}
        _, answer = make({"recipe": "sweep", "profile": square(200), "rail": rail})
        self.assertTrue(answer["ok"])
        self.assertGreater(answer["volume"], 200 * 200 * 3900)
        self.assertLess(answer["volume"], 200 * 200 * 4500)

    def test_a_smooth_rail_is_one_curve(self):
        rail = {"points": [[0, 0, 0], [0, 0, 1500], [1000, 0, 2500], [3000, 0, 3000]], "closed": False}
        _, answer = make({"recipe": "sweep", "profile": square(100), "rail": rail, "smooth": True})
        self.assertTrue(answer["ok"] and answer["valid"])

    def test_a_closed_rail_is_refused(self):
        summary, _ = make({"recipe": "sweep", "profile": square(100), "rail": square(1000)})
        self.assertFalse(summary["ok"])


class Offset(unittest.TestCase):
    def test_a_square_grows_on_every_side(self):
        _, answer = make({"recipe": "offset", "curve": square(1000), "distance": 100})
        points = answer["curves"][0]["points"]
        xs = [p[0] for p in points]
        self.assertEqual((round(min(xs)), round(max(xs))), (-600, 600))
        self.assertTrue(answer["curves"][0]["closed"])

    def test_a_negative_distance_shrinks_it(self):
        _, answer = make({"recipe": "offset", "curve": square(1000), "distance": -100})
        xs = [p[0] for p in answer["curves"][0]["points"]]
        self.assertEqual((round(min(xs)), round(max(xs))), (-400, 400))

    def test_round_corners_add_points(self):
        sharp = make({"recipe": "offset", "curve": square(1000), "distance": 100})[1]
        rounded = make({"recipe": "offset", "curve": square(1000), "distance": 100, "corners": "round"})[1]
        self.assertGreater(len(rounded["curves"][0]["points"]), len(sharp["curves"][0]["points"]))

    def test_a_straight_line_moves_to_the_right_for_a_positive_distance(self):
        line = {"points": [[0, 0, 0], [2000, 0, 0]], "closed": False}
        _, right = make({"recipe": "offset", "curve": line, "distance": 300})
        _, left = make({"recipe": "offset", "curve": line, "distance": -300})
        self.assertEqual(right["curves"][0]["points"], [[0, -300, 0], [2000, -300, 0]])
        self.assertEqual(left["curves"][0]["points"], [[0, 300, 0], [2000, 300, 0]])

    def test_a_bent_line_keeps_its_corner(self):
        line = {"points": [[0, 0, 0], [2000, 0, 0], [2000, 1000, 0]], "closed": False}
        _, answer = make({"recipe": "offset", "curve": line, "distance": 300})
        self.assertEqual(answer["curves"][0]["points"], [[0, -300, 0], [2300, -300, 0], [2300, 1000, 0]])

    def test_a_clockwise_square_also_grows_for_a_positive_distance(self):
        clockwise = dict(square(1000), points=list(reversed(square(1000)["points"])))
        _, answer = make({"recipe": "offset", "curve": clockwise, "distance": 100})
        xs = [p[0] for p in answer["curves"][0]["points"]]
        self.assertEqual((round(min(xs)), round(max(xs))), (-600, 600))

    def test_a_zero_distance_is_refused(self):
        summary, _ = make({"recipe": "offset", "curve": square(1000), "distance": 0})
        self.assertFalse(summary["ok"])


class Requests(unittest.TestCase):
    def test_an_unknown_recipe_is_refused(self):
        summary, _ = make({"recipe": "melt"})
        self.assertFalse(summary["ok"])
        self.assertIn("Unknown recipe", summary["error"])


if __name__ == "__main__":
    unittest.main()
