"""
test_geo.py — Unit tests for ml.geo module
==========================================
Tests synthetic location generation, spatial clustering, Indian coordinate bounds,
KDE and grid-bin heatmap density computations, and serialization formats.
"""

import json
import unittest
from pathlib import Path

from ml.geo import (
    HeatmapEngine,
    SyntheticLocationEngine,
    generate_synthetic_locations,
    haversine_distance_km,
    to_geojson_feature_collection,
    to_leaflet_heat_points,
)


class TestSyntheticLocationEngine(unittest.TestCase):

    def setUp(self):
        self.engine = SyntheticLocationEngine(seed=42)

    def test_generate_location_hits_count_and_structure(self):
        hits = self.engine.generate_location_hits(n_hits=100, fraud_ratio=0.20)
        self.assertEqual(len(hits), 100)

        # Check fraud ratio roughly holds
        fraud_hits = [h for h in hits if h.is_fraud]
        self.assertEqual(len(fraud_hits), 20)

        # Verify fields on first hit
        h = hits[0]
        self.assertTrue(h.hit_id.startswith("HIT"))
        self.assertIsInstance(h.lat, float)
        self.assertIsInstance(h.lng, float)
        self.assertGreaterEqual(h.amount_inr, 0.0)
        self.assertEqual(h.amount_paise, int(h.amount_inr * 100))
        self.assertIn(h.hit_type, ["atm_cashout", "mule_activity", "pos_swipe", "p2p_transfer", "device_login"])
        self.assertTrue(0.0 <= h.risk_score <= 1.0)

    def test_indian_coordinate_bounds(self):
        """Ensure all generated coordinates fall within realistic Indian sub-continent boundaries."""
        hits = self.engine.generate_location_hits(n_hits=500, fraud_ratio=0.30)
        for h in hits:
            # India lat bounds roughly 8°N to 36°N, lng bounds roughly 68°E to 96°E
            self.assertGreaterEqual(h.lat, 8.0, f"Lat {h.lat} below India southern bound")
            self.assertLessEqual(h.lat, 36.0, f"Lat {h.lat} above India northern bound")
            self.assertGreaterEqual(h.lng, 68.0, f"Lng {h.lng} west of India western bound")
            self.assertLessEqual(h.lng, 96.0, f"Lng {h.lng} east of India eastern bound")

    def test_haversine_distance(self):
        # Mumbai (19.0760, 72.8777) to Pune (18.5204, 73.8567) ≈ 120-150 km
        dist = haversine_distance_km(19.0760, 72.8777, 18.5204, 73.8567)
        self.assertGreater(dist, 100.0)
        self.assertLess(dist, 160.0)

    def test_heatmap_grid_aggregation(self):
        hits = self.engine.generate_location_hits(n_hits=300, fraud_ratio=0.25)
        cells_all = HeatmapEngine.compute_grid_heatmap(hits, filter_mode="ALL_HITS")
        self.assertGreater(len(cells_all), 0)

        for c in cells_all:
            self.assertGreaterEqual(c.intensity, 0.0)
            self.assertLessEqual(c.intensity, 1.0)
            self.assertGreater(c.hit_count, 0)
            self.assertGreaterEqual(c.fraud_hit_count, 0)
            self.assertGreaterEqual(c.total_amount_inr, 0.0)

        # Test FRAUD_ONLY filter
        cells_fraud = HeatmapEngine.compute_grid_heatmap(hits, filter_mode="FRAUD_ONLY")
        for c in cells_fraud:
            self.assertGreater(c.fraud_hit_count, 0)

    def test_continuous_kde(self):
        hits = self.engine.generate_location_hits(n_hits=150, fraud_ratio=0.20)
        kde = HeatmapEngine.compute_continuous_kde(hits, bandwidth_km=15.0, grid_points_lat=20, grid_points_lng=20)

        self.assertEqual(len(kde["grid_lat"]), 20)
        self.assertEqual(len(kde["grid_lng"]), 20)
        self.assertEqual(len(kde["density_matrix"]), 20)
        self.assertEqual(len(kde["density_matrix"][0]), 20)

    def test_export_formats(self):
        hits = self.engine.generate_location_hits(n_hits=50, fraud_ratio=0.20)

        # Leaflet points
        leaflet_pts = to_leaflet_heat_points(hits)
        self.assertEqual(len(leaflet_pts), 50)
        self.assertEqual(len(leaflet_pts[0]), 3)  # [lat, lng, intensity]

        # GeoJSON
        geojson = to_geojson_feature_collection(hits)
        self.assertEqual(geojson["type"], "FeatureCollection")
        self.assertEqual(len(geojson["features"]), 50)
        self.assertEqual(geojson["features"][0]["geometry"]["type"], "Point")

    def test_pipeline_generate_and_save(self):
        test_out = Path("ml/data/test_geo_out")
        res = generate_synthetic_locations(n_hits=100, fraud_ratio=0.2, seed=99, output_dir=test_out)

        self.assertIn("hits", res)
        self.assertIn("heatmap_grid", res)
        self.assertIn("html_visualization", res)

        # Check files were created
        self.assertTrue((test_out / "locations.json").exists())
        self.assertTrue((test_out / "heatmap_locations.json").exists())
        self.assertTrue((test_out / "locations.geojson").exists())
        self.assertTrue((test_out / "heatmap_dashboard.html").exists())

        # Cleanup test files
        for f in test_out.iterdir():
            f.unlink()
        test_out.rmdir()


if __name__ == "__main__":
    unittest.main()
