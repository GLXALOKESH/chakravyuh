"""
geo.py — Synthetic Geospatial Location & Heatmap Engine for Chakravyuh
======================================================================
Generates realistic multi-cluster synthetic geospatial locations, ATM cash-out
hotspots, cyber fraud corridors, and continuous KDE heatmaps based on transaction
and account hits across India.

Capabilities:
  1. Real Indian Geospatial Clusters:
     - Tier 1 Metro economic zones (Mumbai, Delhi-NCR, Bengaluru, Hyderabad, Kolkata, Chennai, Pune, Ahmedabad)
     - Regional tier 2/3 financial centers (Jaipur, Lucknow, Surat, Indore, Patna, Bhopal, Kochi, etc.)
     - High-risk cybercrime & mule operation corridors (Jamtara/Deoghar, Mewat/Nuh/Bharatpur, Alwar, etc.)
  2. Multi-Modal Hit Generators:
     - ATM Cash-Out Hits: Concentrated spatial bursts at physical ATMs (night sweeps, coordinated withdrawals)
     - Mule Account Operating Clusters: Co-located device / account physical footprint
     - Cyber Fraud Origin Hits: Rapid fan-out command zones
     - Normal Merchant & P2P Footprint: Broad population-weighted dispersion
  3. Heatmap Density & Kernel Calculations:
     - Fast 2D Spatial Binning with configurable grid resolution (e.g. 0.005° ~ 550m, 0.01° ~ 1.1km)
     - Gaussian 2D Kernel Density Estimation (KDE) with adaptive bandwidth
     - Multi-Metric Aggregation: hit count, fraud hit count, transaction volume (INR), avg risk score
     - Layer filtering: ALL_HITS, FRAUD_ONLY, ATM_CASHOUTS, MULE_HUBS, RISK_WEIGHTED
  4. Multiple Export Formats:
     - Raw Hit Points: [lat, lng, intensity, count] (Leaflet Heat, Mapbox, Deck.gl)
     - GeoJSON FeatureCollection (GIS / web maps)
     - Structured JSON (REST API / Chakravyuh dashboard)
     - Standalone Interactive Dark-Mode HTML Heatmap Viewer

Usage:
  python -m ml.geo --generate --profile demo
  python -m ml.geo --export-html ml/data/heatmap_demo.html
"""

import argparse
import json
import math
import random
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# ─────────────────────────────────────────────────────────────────
# 1. GEOGRAPHIC DEFINITIONS & HOTSPOT ZONES
# ─────────────────────────────────────────────────────────────────

# Major Urban Centers with population weights & sub-district clusters
URBAN_CENTERS = [
    {
        "city": "Mumbai",
        "state": "Maharashtra",
        "lat": 19.0760,
        "lng": 72.8777,
        "weight": 1.0,
        "radius_km": 28.0,
        "sub_clusters": [
            {"name": "BKC Financial District", "lat": 19.0657, "lng": 72.8683, "risk_mult": 0.8},
            {"name": "Andheri Commercial Hub", "lat": 19.1197, "lng": 72.8464, "risk_mult": 1.2},
            {"name": "Navi Mumbai Tech Zone", "lat": 19.0330, "lng": 73.0297, "risk_mult": 1.0},
            {"name": "South Mumbai Banking", "lat": 18.9322, "lng": 72.8315, "risk_mult": 0.7},
            {"name": "Thane Outskirts", "lat": 19.2183, "lng": 72.9781, "risk_mult": 1.3},
        ],
    },
    {
        "city": "Delhi-NCR",
        "state": "Delhi / Haryana / UP",
        "lat": 28.6139,
        "lng": 77.2090,
        "weight": 1.0,
        "radius_km": 35.0,
        "sub_clusters": [
            {"name": "Connaught Place Hub", "lat": 28.6315, "lng": 77.2167, "risk_mult": 0.8},
            {"name": "Cyber City Gurugram", "lat": 28.4950, "lng": 77.0895, "risk_mult": 1.3},
            {"name": "Noida Sector 62 IT Hub", "lat": 28.6280, "lng": 77.3649, "risk_mult": 1.1},
            {"name": "Laxmi Nagar / East Delhi", "lat": 28.6304, "lng": 77.2773, "risk_mult": 1.4},
            {"name": "Dwarka Transit Hub", "lat": 28.5921, "lng": 77.0460, "risk_mult": 1.0},
        ],
    },
    {
        "city": "Bengaluru",
        "state": "Karnataka",
        "lat": 12.9716,
        "lng": 77.5946,
        "weight": 0.9,
        "radius_km": 25.0,
        "sub_clusters": [
            {"name": "Whitefield Tech Corridor", "lat": 12.9698, "lng": 77.7500, "risk_mult": 1.0},
            {"name": "Electronic City", "lat": 12.8399, "lng": 77.6770, "risk_mult": 0.9},
            {"name": "Koramangala Commercial", "lat": 12.9352, "lng": 77.6245, "risk_mult": 1.1},
            {"name": "Majestic Transit Terminal", "lat": 12.9767, "lng": 77.5713, "risk_mult": 1.5},
            {"name": "Indiranagar", "lat": 12.9784, "lng": 77.6408, "risk_mult": 0.8},
        ],
    },
    {
        "city": "Hyderabad",
        "state": "Telangana",
        "lat": 17.3850,
        "lng": 78.4867,
        "weight": 0.85,
        "radius_km": 24.0,
        "sub_clusters": [
            {"name": "HITEC City", "lat": 17.4474, "lng": 78.3762, "risk_mult": 0.9},
            {"name": "Secunderabad Transit Hub", "lat": 17.4399, "lng": 78.4983, "risk_mult": 1.3},
            {"name": "Old City Charminar", "lat": 17.3616, "lng": 78.4747, "risk_mult": 1.2},
            {"name": "Gachibowli Financial District", "lat": 17.4401, "lng": 78.3489, "risk_mult": 0.8},
        ],
    },
    {
        "city": "Kolkata",
        "state": "West Bengal",
        "lat": 22.5726,
        "lng": 88.3639,
        "weight": 0.85,
        "radius_km": 22.0,
        "sub_clusters": [
            {"name": "Salt Lake Sector V IT Hub", "lat": 22.5807, "lng": 88.4378, "risk_mult": 1.4},
            {"name": "Howrah Station Terminal", "lat": 22.5830, "lng": 88.3426, "risk_mult": 1.6},
            {"name": "Park Street / BBD Bagh", "lat": 22.5550, "lng": 88.3510, "risk_mult": 0.9},
            {"name": "Rajarhat New Town", "lat": 22.6288, "lng": 88.4650, "risk_mult": 1.2},
        ],
    },
    {
        "city": "Chennai",
        "state": "Tamil Nadu",
        "lat": 13.0827,
        "lng": 80.2707,
        "weight": 0.8,
        "radius_km": 22.0,
        "sub_clusters": [
            {"name": "OMR Tech Corridor", "lat": 12.9165, "lng": 80.2285, "risk_mult": 0.9},
            {"name": "Chennai Central Hub", "lat": 13.0823, "lng": 80.2755, "risk_mult": 1.3},
            {"name": "T. Nagar Commercial", "lat": 13.0418, "lng": 80.2341, "risk_mult": 1.1},
        ],
    },
    {
        "city": "Pune",
        "state": "Maharashtra",
        "lat": 18.5204,
        "lng": 73.8567,
        "weight": 0.75,
        "radius_km": 18.0,
        "sub_clusters": [
            {"name": "Hinjawadi IT Park", "lat": 18.5913, "lng": 73.7389, "risk_mult": 0.9},
            {"name": "Shivajinagar Central", "lat": 18.5308, "lng": 73.8475, "risk_mult": 1.1},
            {"name": "Viman Nagar Commercial", "lat": 18.5679, "lng": 73.9143, "risk_mult": 1.0},
        ],
    },
    {
        "city": "Ahmedabad",
        "state": "Gujarat",
        "lat": 23.0225,
        "lng": 72.5714,
        "weight": 0.75,
        "radius_km": 20.0,
        "sub_clusters": [
            {"name": "SG Highway Commercial", "lat": 23.0537, "lng": 72.5085, "risk_mult": 1.0},
            {"name": "Maninagar Hub", "lat": 22.9978, "lng": 72.6033, "risk_mult": 1.2},
            {"name": "GIFT City Corridor", "lat": 23.1610, "lng": 72.6840, "risk_mult": 0.7},
        ],
    },
    {
        "city": "Jaipur",
        "state": "Rajasthan",
        "lat": 26.9124,
        "lng": 75.7873,
        "weight": 0.65,
        "radius_km": 16.0,
        "sub_clusters": [
            {"name": "MI Road Commercial", "lat": 26.9180, "lng": 75.8050, "risk_mult": 1.1},
            {"name": "Mansarovar Outskirts", "lat": 26.8530, "lng": 75.7680, "risk_mult": 1.3},
        ],
    },
    {
        "city": "Lucknow",
        "state": "Uttar Pradesh",
        "lat": 26.8467,
        "lng": 80.9462,
        "weight": 0.65,
        "radius_km": 16.0,
        "sub_clusters": [
            {"name": "Hazratganj Central", "lat": 26.8520, "lng": 80.9450, "risk_mult": 1.0},
            {"name": "Charbagh Station", "lat": 26.8290, "lng": 80.9200, "risk_mult": 1.5},
        ],
    },
    {
        "city": "Surat",
        "state": "Gujarat",
        "lat": 21.1702,
        "lng": 72.8311,
        "weight": 0.6,
        "radius_km": 14.0,
        "sub_clusters": [
            {"name": "Diamond Bourse Market", "lat": 21.1630, "lng": 72.8420, "risk_mult": 1.2},
            {"name": "Ring Road Textile Market", "lat": 21.1890, "lng": 72.8450, "risk_mult": 1.3},
        ],
    },
    {
        "city": "Patna",
        "state": "Bihar",
        "lat": 25.5941,
        "lng": 85.1376,
        "weight": 0.55,
        "radius_km": 14.0,
        "sub_clusters": [
            {"name": "Patna Junction Central", "lat": 25.6020, "lng": 85.1350, "risk_mult": 1.6},
            {"name": "Kankarbagh Residential", "lat": 25.5910, "lng": 85.1580, "risk_mult": 1.2},
        ],
    },
    {
        "city": "Kochi",
        "state": "Kerala",
        "lat": 9.9312,
        "lng": 76.2673,
        "weight": 0.5,
        "radius_km": 12.0,
        "sub_clusters": [
            {"name": "Kakkanad InfoPark", "lat": 10.0120, "lng": 76.3630, "risk_mult": 0.8},
            {"name": "MG Road Ernakulam", "lat": 9.9720, "lng": 76.2790, "risk_mult": 1.1},
        ],
    },
]

# High-Intensity Fraud & Mule Hotspot Corridors (Known clusters in financial crime intelligence)
FRAUD_HOTSPOT_CORRIDORS = [
    {
        "name": "Jamtara-Deoghar Cyber Belt",
        "region": "Jharkhand",
        "lat": 23.9630,
        "lng": 86.8020,
        "radius_km": 15.0,
        "intensity": 0.95,
        "primary_hit_type": "mule_activity",
        "description": "High-density phishing operation call-origin and mule dispatch hub",
    },
    {
        "name": "Mewat-Nuh-Alwar Corridor",
        "region": "Haryana / Rajasthan",
        "lat": 28.1060,
        "lng": 77.0040,
        "radius_km": 20.0,
        "intensity": 0.92,
        "primary_hit_type": "atm_cashout",
        "description": "Rapid ATM sweep corridor & multi-device SIM farm cluster",
    },
    {
        "name": "Bharatpur Cyber Fringe",
        "region": "Rajasthan",
        "lat": 27.2152,
        "lng": 77.4930,
        "radius_km": 12.0,
        "intensity": 0.88,
        "primary_hit_type": "mule_activity",
        "description": "Cross-border mule account onboarding nexus",
    },
    {
        "name": "Asansol-Durgapur Industrial Belt",
        "region": "West Bengal",
        "lat": 23.6889,
        "lng": 86.9661,
        "radius_km": 18.0,
        "intensity": 0.78,
        "primary_hit_type": "atm_cashout",
        "description": "Coordinated multi-bank ATM cashout ring drop-off points",
    },
]

ATM_TERMINALS_SAMPLE = [
    {"bank": "SBI", "model": "Diebold Nixdorf", "prefix": "ATM-SBI"},
    {"bank": "HDFC", "model": "NCR SelfServ", "prefix": "ATM-HDFC"},
    {"bank": "ICICI", "model": "Wincor Nixdorf", "prefix": "ATM-ICICI"},
    {"bank": "Axis", "model": "Hyosung Monimax", "prefix": "ATM-AXIS"},
    {"bank": "PNB", "model": "NCR SelfServ", "prefix": "ATM-PNB"},
]


# ─────────────────────────────────────────────────────────────────
# 2. DATA CLASSES & MODELS
# ─────────────────────────────────────────────────────────────────

@dataclass
class LocationHit:
    """A single spatial event hit (ATM withdrawal, P2P transfer, mule login, POS swipe)."""
    hit_id: str
    lat: float
    lng: float
    city: str
    state: str
    hit_type: str                  # atm_cashout, mule_activity, pos_swipe, p2p_transfer, device_login
    timestamp: str                 # ISO 8601
    amount_inr: float              # Rupee amount of transaction/hit
    amount_paise: int              # Integer paise
    is_fraud: bool
    risk_score: float              # 0.00 to 1.00
    account_id: Optional[str] = None
    ring_id: Optional[str] = None
    terminal_id: Optional[str] = None
    cluster_name: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class HeatmapCell:
    """Aggregated spatial bin or KDE cell for rendering heatmaps."""
    lat: float
    lng: float
    intensity: float               # Normalized 0.0 to 1.0 for rendering
    raw_density: float             # Unnormalized kernel density / hit metric
    hit_count: int
    fraud_hit_count: int
    total_amount_inr: float
    avg_risk_score: float
    dominant_hit_type: str
    city: str
    is_hotspot: bool


# ─────────────────────────────────────────────────────────────────
# 3. SPATIAL MATH & DISPERSION UTILITIES
# ─────────────────────────────────────────────────────────────────

def haversine_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate great-circle distance between two points in km."""
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def generate_gaussian_point(
    center_lat: float,
    center_lng: float,
    sigma_km: float,
    rng: random.Random,
) -> Tuple[float, float]:
    """
    Generate a 2D Gaussian displaced coordinate around a center in kilometers.
    Applies spherical cosine correction for longitude.
    """
    # 1 deg latitude ≈ 111.0 km
    # 1 deg longitude ≈ 111.0 * cos(lat) km
    lat_scale = 111.0
    lng_scale = 111.0 * math.cos(math.radians(center_lat))
    if lng_scale <= 0.001:
        lng_scale = 111.0

    # Box-Muller / normal random displacement
    d_north_km = rng.gauss(0.0, sigma_km)
    d_east_km = rng.gauss(0.0, sigma_km)

    new_lat = center_lat + (d_north_km / lat_scale)
    new_lng = center_lng + (d_east_km / lng_scale)

    return round(new_lat, 6), round(new_lng, 6)


# ─────────────────────────────────────────────────────────────────
# 4. SYNTHETIC LOCATION & HIT GENERATOR
# ─────────────────────────────────────────────────────────────────

class SyntheticLocationEngine:
    """
    High-fidelity geospatial engine for generating synthetic transaction locations,
    ATM cash-out hits, mule network operational clusters, and heatmap layers.
    """

    def __init__(self, seed: int = 42):
        self.seed = seed
        self.rng = random.Random(seed)
        self.np_rng = np.random.default_rng(seed)

    def generate_location_hits(
        self,
        n_hits: int = 2500,
        fraud_ratio: float = 0.15,
        start_date: str = "2026-09-25T00:00:00Z",
        days: int = 7,
        profile: str = "demo",
    ) -> List[LocationHit]:
        """
        Generate a comprehensive dataset of synthetic geospatial hits.
        Combines realistic normal commerce traffic with concentrated fraud rings,
        ATM cashouts, and cybercrime hotspots.
        """
        hits: List[LocationHit] = []
        start_dt = datetime.strptime(start_date, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        total_seconds = max(1, int(days * 86400))

        n_fraud_hits = int(n_hits * fraud_ratio)
        n_normal_hits = n_hits - n_fraud_hits

        hit_counter = 1

        # ─────────────────────────────────────────────────────────────
        # A. Normal Commercial & Retail Hits (Broad Urban Distribution)
        # ─────────────────────────────────────────────────────────────
        city_weights = [c["weight"] for c in URBAN_CENTERS]
        total_w = sum(city_weights)
        norm_weights = [w / total_w for w in city_weights]

        for _ in range(n_normal_hits):
            city_obj = self.rng.choices(URBAN_CENTERS, weights=norm_weights, k=1)[0]
            
            # Select sub-cluster or general city spread
            if "sub_clusters" in city_obj and self.rng.random() < 0.70:
                sub = self.rng.choice(city_obj["sub_clusters"])
                center_lat, center_lng = sub["lat"], sub["lng"]
                cluster_name = f"{city_obj['city']} - {sub['name']}"
                sigma_km = self.rng.uniform(0.5, 2.5)
            else:
                center_lat, center_lng = city_obj["lat"], city_obj["lng"]
                cluster_name = f"{city_obj['city']} Metro"
                sigma_km = self.rng.uniform(2.0, city_obj.get("radius_km", 15.0) * 0.4)

            lat, lng = generate_gaussian_point(center_lat, center_lng, sigma_km, self.rng)
            
            # Hit type weights for normal traffic
            hit_type = self.rng.choices(
                ["p2p_transfer", "pos_swipe", "atm_cashout", "device_login"],
                weights=[0.50, 0.35, 0.10, 0.05],
                k=1,
            )[0]

            amount_inr = round(self.rng.uniform(100.0, 15000.0), 2)
            if hit_type == "atm_cashout":
                amount_inr = round(self.rng.randint(5, 100) * 100.0, 2)

            ts = start_dt + timedelta(seconds=self.rng.randint(0, total_seconds))
            risk_score = round(self.rng.uniform(0.01, 0.28), 3)

            term_id = None
            if hit_type == "atm_cashout":
                atm_meta = self.rng.choice(ATM_TERMINALS_SAMPLE)
                term_id = f"{atm_meta['prefix']}-{self.rng.randint(1000, 9999)}"

            hits.append(
                LocationHit(
                    hit_id=f"HIT{hit_counter:07d}",
                    lat=lat,
                    lng=lng,
                    city=city_obj["city"],
                    state=city_obj["state"],
                    hit_type=hit_type,
                    timestamp=ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    amount_inr=amount_inr,
                    amount_paise=int(amount_inr * 100),
                    is_fraud=False,
                    risk_score=risk_score,
                    account_id=f"ACC{self.rng.randint(1, 600):04d}",
                    ring_id=None,
                    terminal_id=term_id,
                    cluster_name=cluster_name,
                )
            )
            hit_counter += 1

        # ─────────────────────────────────────────────────────────────
        # B. Fraud Rings & Hotspot Hits (High-Density Clustering)
        # ─────────────────────────────────────────────────────────────
        rings = [
            {"id": "RING01", "name": "Rapid ATM Mule Sweep Ring", "type": "Pattern_A_FanOut", "volume": 1200000},
            {"id": "RING02", "name": "Mewat-Gurugram Cyber Layering", "type": "Pattern_B_Cycle", "volume": 2800000},
            {"id": "RING03", "name": "Salt Lake Shell Accounts", "type": "Pattern_C_Layered", "volume": 1650000},
        ]

        # Allocate fraud hits among dedicated hotspots and targeted cities
        for _ in range(n_fraud_hits):
            ring = self.rng.choice(rings)
            fraud_flavor = self.rng.choices(["corridor_hotspot", "targeted_atm_cluster", "transit_drop"], weights=[0.45, 0.40, 0.15])[0]

            if fraud_flavor == "corridor_hotspot":
                corridor = self.rng.choice(FRAUD_HOTSPOT_CORRIDORS)
                center_lat, center_lng = corridor["lat"], corridor["lng"]
                city = corridor["region"]
                state = corridor["region"]
                cluster_name = corridor["name"]
                hit_type = corridor["primary_hit_type"]
                sigma_km = self.rng.uniform(0.3, 1.8)
                base_risk = corridor["intensity"]
            elif fraud_flavor == "targeted_atm_cluster":
                # Concentrated ATM cashouts in specific city commercial nodes
                city_obj = self.rng.choice(URBAN_CENTERS[:4])  # Mumbai, Delhi, BLR, HYD
                sub = self.rng.choice(city_obj.get("sub_clusters", [{"name": "Central", "lat": city_obj["lat"], "lng": city_obj["lng"], "risk_mult": 1.2}]))
                center_lat, center_lng = sub["lat"], sub["lng"]
                city = city_obj["city"]
                state = city_obj["state"]
                cluster_name = f"Fraud ATM Cluster - {sub['name']}"
                hit_type = "atm_cashout"
                sigma_km = self.rng.uniform(0.15, 0.8)   # Very tight spatial burst
                base_risk = 0.88
            else:
                # Transit / Railway station cashout sweeps
                transit_city = self.rng.choice([c for c in URBAN_CENTERS if "Kolkata" in c["city"] or "Delhi" in c["city"] or "Mumbai" in c["city"]])
                center_lat, center_lng = transit_city["lat"], transit_city["lng"]
                city = transit_city["city"]
                state = transit_city["state"]
                cluster_name = f"{city} Transit Sweep"
                hit_type = "atm_cashout"
                sigma_km = self.rng.uniform(0.2, 1.0)
                base_risk = 0.82

            lat, lng = generate_gaussian_point(center_lat, center_lng, sigma_km, self.rng)
            amount_inr = round(self.rng.randint(200, 1000) * 100.0, 2)  # ₹20,000 - ₹100,000
            ts = start_dt + timedelta(seconds=self.rng.randint(0, total_seconds))
            risk_score = round(min(0.99, max(0.65, self.rng.gauss(base_risk, 0.06))), 3)

            atm_meta = self.rng.choice(ATM_TERMINALS_SAMPLE)
            term_id = f"{atm_meta['prefix']}-{self.rng.randint(5000, 9999)}"

            hits.append(
                LocationHit(
                    hit_id=f"HIT{hit_counter:07d}",
                    lat=lat,
                    lng=lng,
                    city=city,
                    state=state,
                    hit_type=hit_type,
                    timestamp=ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    amount_inr=amount_inr,
                    amount_paise=int(amount_inr * 100),
                    is_fraud=True,
                    risk_score=risk_score,
                    account_id=f"ACC{self.rng.randint(10, 45):04d}",
                    ring_id=ring["id"],
                    terminal_id=term_id,
                    cluster_name=cluster_name,
                    metadata={"pattern": ring["type"], "ring_name": ring["name"]},
                )
            )
            hit_counter += 1

        # Sort all hits chronologically
        hits.sort(key=lambda h: h.timestamp)
        return hits


# ─────────────────────────────────────────────────────────────────
# 5. HEATMAP & KDE AGGREGATION ENGINE
# ─────────────────────────────────────────────────────────────────

class HeatmapEngine:
    """
    Computes spatial density distributions, Kernel Density Estimation (KDE),
    and grid-binned aggregations for heatmap visualization.
    """

    @staticmethod
    def compute_grid_heatmap(
        hits: List[LocationHit],
        grid_resolution_deg: float = 0.02,   # ~2.2 km resolution
        filter_mode: str = "ALL_HITS",        # ALL_HITS | FRAUD_ONLY | ATM_CASHOUTS | RISK_WEIGHTED
        min_hits_per_cell: int = 1,
    ) -> List[HeatmapCell]:
        """
        Aggregates individual point hits into discrete geospatial grid bins,
        calculating intensity, fraud density, transaction volumes, and risk.
        """
        # Apply filter
        filtered_hits: List[LocationHit] = []
        for h in hits:
            if filter_mode == "FRAUD_ONLY" and not h.is_fraud:
                continue
            if filter_mode == "ATM_CASHOUTS" and h.hit_type != "atm_cashout":
                continue
            filtered_hits.append(h)

        if not filtered_hits:
            return []

        # Binning dictionary: (grid_lat, grid_lng) -> list of hits
        bins: Dict[Tuple[float, float], List[LocationHit]] = defaultdict(list)

        for h in filtered_hits:
            # Snap to grid centroid
            bin_lat = round(math.floor(h.lat / grid_resolution_deg) * grid_resolution_deg + (grid_resolution_deg / 2.0), 4)
            bin_lng = round(math.floor(h.lng / grid_resolution_deg) * grid_resolution_deg + (grid_resolution_deg / 2.0), 4)
            bins[(bin_lat, bin_lng)].append(h)

        cells: List[HeatmapCell] = []
        raw_densities: List[float] = []

        for (b_lat, b_lng), b_hits in bins.items():
            if len(b_hits) < min_hits_per_cell:
                continue

            hit_count = len(b_hits)
            fraud_count = sum(1 for x in b_hits if x.is_fraud)
            total_amt = sum(x.amount_inr for x in b_hits)
            avg_risk = sum(x.risk_score for x in b_hits) / hit_count

            # Determine dominant hit type
            type_counts = defaultdict(int)
            city_counts = defaultdict(int)
            for x in b_hits:
                type_counts[x.hit_type] += 1
                city_counts[x.city] += 1
            dom_type = max(type_counts.items(), key=lambda kv: kv[1])[0]
            dom_city = max(city_counts.items(), key=lambda kv: kv[1])[0]

            # Density metric calculation based on filter mode
            if filter_mode == "RISK_WEIGHTED":
                raw_d = sum(x.risk_score * (1.5 if x.is_fraud else 1.0) for x in b_hits)
            elif filter_mode == "FRAUD_ONLY":
                raw_d = float(fraud_count * 2.0 + (total_amt / 50000.0))
            else:
                raw_d = float(hit_count + (fraud_count * 1.5))

            raw_densities.append(raw_d)
            is_hotspot = (fraud_count >= 3) or (avg_risk >= 0.70) or (hit_count >= 15)

            cells.append(
                HeatmapCell(
                    lat=b_lat,
                    lng=b_lng,
                    intensity=0.0,   # will be normalized below
                    raw_density=raw_d,
                    hit_count=hit_count,
                    fraud_hit_count=fraud_count,
                    total_amount_inr=round(total_amt, 2),
                    avg_risk_score=round(avg_risk, 3),
                    dominant_hit_type=dom_type,
                    city=dom_city,
                    is_hotspot=is_hotspot,
                )
            )

        if not cells:
            return []

        # Normalize intensities 0.05 to 1.0 using non-linear log-scaling for high contrast
        max_density = max(raw_densities) if raw_densities else 1.0
        for c in cells:
            if max_density > 0:
                # Log-transformed normalization to highlight both dense hubs and medium hotspots
                norm = math.log1p(c.raw_density) / math.log1p(max_density)
                c.intensity = round(max(0.05, min(1.0, norm)), 4)
            else:
                c.intensity = 0.5

        # Sort descending by intensity
        cells.sort(key=lambda c: c.intensity, reverse=True)
        return cells

    @staticmethod
    def compute_continuous_kde(
        hits: List[LocationHit],
        bandwidth_km: float = 8.0,
        grid_points_lat: int = 50,
        grid_points_lng: int = 50,
        bounds: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """
        Computes a continuous 2D Gaussian Kernel Density Estimation surface over India/selected bounds.
        Returns a 2D density matrix with coordinate axes for contour or raster visualization.
        """
        if not hits:
            return {"lats": [], "lngs": [], "density": []}

        all_lats = np.array([h.lat for h in hits], dtype=np.float64)
        all_lngs = np.array([h.lng for h in hits], dtype=np.float64)
        weights = np.array([h.risk_score * (2.0 if h.is_fraud else 1.0) for h in hits], dtype=np.float64)

        if bounds is None:
            min_lat, max_lat = max(8.0, float(np.min(all_lats)) - 0.5), min(36.0, float(np.max(all_lats)) + 0.5)
            min_lng, max_lng = max(68.0, float(np.min(all_lngs)) - 0.5), min(96.0, float(np.max(all_lngs)) + 0.5)
        else:
            min_lat, max_lat = bounds["min_lat"], bounds["max_lat"]
            min_lng, max_lng = bounds["min_lng"], bounds["max_lng"]

        grid_lat = np.linspace(min_lat, max_lat, grid_points_lat)
        grid_lng = np.linspace(min_lng, max_lng, grid_points_lng)
        mesh_lng, mesh_lat = np.meshgrid(grid_lng, grid_lat)

        # Vectorized Gaussian kernel computation
        # approx: 1 deg lat ~ 111 km, 1 deg lng ~ 111 * cos(mean_lat) km
        mean_lat_rad = math.radians((min_lat + max_lat) / 2.0)
        lat_scale = 111.0
        lng_scale = 111.0 * math.cos(mean_lat_rad)
        h_sq = bandwidth_km ** 2

        density_surface = np.zeros_like(mesh_lat, dtype=np.float64)

        # Batch evaluation
        for lat_i, lng_i, w_i in zip(all_lats, all_lngs, weights):
            d_north = (mesh_lat - lat_i) * lat_scale
            d_east = (mesh_lng - lng_i) * lng_scale
            dist_sq = d_north**2 + d_east**2
            kernel_val = np.exp(-0.5 * dist_sq / h_sq) * w_i
            density_surface += kernel_val

        # Normalize density 0.0 to 1.0
        max_val = float(np.max(density_surface))
        if max_val > 0:
            density_surface /= max_val

        return {
            "grid_lat": grid_lat.tolist(),
            "grid_lng": grid_lng.tolist(),
            "density_matrix": density_surface.round(4).tolist(),
            "bandwidth_km": bandwidth_km,
            "bounds": {"min_lat": min_lat, "max_lat": max_lat, "min_lng": min_lng, "max_lng": max_lng},
        }


# ─────────────────────────────────────────────────────────────────
# 6. EXPORT FORMATTERS (JSON, GeoJSON, Leaflet Heatmap Points, HTML)
# ─────────────────────────────────────────────────────────────────

def to_leaflet_heat_points(hits: List[LocationHit], weight_by_risk: bool = True) -> List[List[float]]:
    """
    Exports hit points formatted specifically for Leaflet.heat / Mapbox Heatmap:
    Format: [[lat, lng, intensity], ...]
    """
    points = []
    for h in hits:
        if weight_by_risk:
            # Scale intensity: higher for fraud and high risk
            intensity = round(min(1.0, max(0.2, h.risk_score * (1.4 if h.is_fraud else 0.6))), 3)
        else:
            intensity = 0.6 if not h.is_fraud else 1.0
        points.append([round(h.lat, 5), round(h.lng, 5), intensity])
    return points


def to_geojson_feature_collection(hits: List[LocationHit], max_points: int = 5000) -> Dict[str, Any]:
    """Converts location hits to standard GeoJSON FeatureCollection."""
    features = []
    for h in hits[:max_points]:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [h.lng, h.lat],  # GeoJSON is [longitude, latitude]
            },
            "properties": {
                "hit_id": h.hit_id,
                "city": h.city,
                "state": h.state,
                "hit_type": h.hit_type,
                "timestamp": h.timestamp,
                "amount_inr": h.amount_inr,
                "amount_paise": h.amount_paise,
                "is_fraud": h.is_fraud,
                "risk_score": h.risk_score,
                "account_id": h.account_id,
                "ring_id": h.ring_id,
                "terminal_id": h.terminal_id,
                "cluster_name": h.cluster_name,
            },
        })

    return {
        "type": "FeatureCollection",
        "total_features": len(features),
        "features": features,
    }


def generate_interactive_heatmap_html(
    hits: List[LocationHit],
    cells: List[HeatmapCell],
    title: str = "Chakravyuh — Synthetic Geospatial Fraud & ATM Hit Heatmap",
) -> str:
    """
    Generates a standalone, rich, interactive Leaflet dark-mode heatmap HTML page
    with real-time layer switching, cluster inspection, and metric badges.
    """
    # Prepare datasets for embedded JS
    all_points = to_leaflet_heat_points(hits, weight_by_risk=True)
    fraud_points = to_leaflet_heat_points([h for h in hits if h.is_fraud], weight_by_risk=True)
    atm_points = to_leaflet_heat_points([h for h in hits if h.hit_type == "atm_cashout"], weight_by_risk=True)

    # Top hotspot markers
    hotspot_markers = []
    for c in cells[:40]:
        hotspot_markers.append({
            "lat": c.lat,
            "lng": c.lng,
            "city": c.city,
            "intensity": c.intensity,
            "hit_count": c.hit_count,
            "fraud_hit_count": c.fraud_hit_count,
            "total_amount_inr": f"₹{c.total_amount_inr:,.2f}",
            "avg_risk": c.avg_risk_score,
            "dominant_type": c.dominant_hit_type,
        })

    total_hits = len(hits)
    total_fraud = sum(1 for h in hits if h.is_fraud)
    total_volume_inr = sum(h.amount_inr for h in hits)
    total_atm = sum(1 for h in hits if h.hit_type == "atm_cashout")

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  
  <!-- Leaflet CSS & JS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <!-- Leaflet Heat Plugin -->
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>

  <style>
    :root {{
      --bg-dark: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.85);
      --accent-cyan: #06b6d4;
      --accent-rose: #f43f5e;
      --accent-amber: #f59e0b;
      --accent-emerald: #10b981;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: rgba(255, 255, 255, 0.1);
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }}

    body {{
      background: var(--bg-dark);
      color: var(--text-main);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }}

    /* Top Navigation Bar */
    header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: rgba(15, 23, 42, 0.95);
      border-bottom: 1px solid var(--border-color);
      z-index: 1000;
      backdrop-filter: blur(8px);
    }}

    .logo-badge {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}

    .logo-badge h1 {{
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.5px;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}

    .stats-bar {{
      display: flex;
      gap: 16px;
    }}

    .stat-pill {{
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      padding: 4px 12px;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }}

    .stat-pill .label {{
      font-size: 10px;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.5px;
    }}

    .stat-pill .val {{
      font-size: 14px;
      font-weight: 700;
      color: var(--text-main);
    }}

    .stat-pill .val.highlight-rose {{ color: var(--accent-rose); }}
    .stat-pill .val.highlight-cyan {{ color: var(--accent-cyan); }}

    /* Layout */
    .main-container {{
      position: relative;
      flex: 1;
      width: 100%;
      height: 100%;
    }}

    #map {{
      width: 100%;
      height: 100%;
      background: #090d16;
    }}

    /* Floating Control Panel */
    .controls-panel {{
      position: absolute;
      top: 20px;
      left: 20px;
      z-index: 1000;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 18px;
      width: 320px;
      backdrop-filter: blur(12px);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }}

    .panel-title {{
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--text-main);
    }}

    .btn-group {{
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }}

    .layer-btn {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }}

    .layer-btn:hover {{
      background: rgba(255, 255, 255, 0.1);
      transform: translateY(-1px);
    }}

    .layer-btn.active {{
      background: rgba(6, 182, 212, 0.2);
      border-color: var(--accent-cyan);
      color: #38bdf8;
      box-shadow: 0 0 12px rgba(6, 182, 212, 0.3);
    }}

    .layer-btn.active.rose {{
      background: rgba(244, 63, 94, 0.2);
      border-color: var(--accent-rose);
      color: #fb7185;
      box-shadow: 0 0 12px rgba(244, 63, 94, 0.3);
    }}

    .slider-container {{
      margin-top: 12px;
    }}

    .slider-label {{
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }}

    input[type=range] {{
      width: 100%;
      accent-color: var(--accent-cyan);
    }}

    /* Legend */
    .legend {{
      position: absolute;
      bottom: 24px;
      right: 24px;
      z-index: 1000;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 14px 18px;
      backdrop-filter: blur(12px);
      font-size: 12px;
      color: var(--text-muted);
    }}

    .gradient-bar {{
      height: 10px;
      width: 180px;
      border-radius: 5px;
      margin: 8px 0;
      background: linear-gradient(to right, blue, cyan, lime, yellow, red);
    }}

    .legend-labels {{
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--text-muted);
    }}

    /* Custom Map Marker Popup */
    .leaflet-popup-content-wrapper {{
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      backdrop-filter: blur(8px);
    }}
    .leaflet-popup-tip {{
      background: rgba(15, 23, 42, 0.95);
    }}
  </style>
</head>
<body>

  <header>
    <div class="logo-badge">
      <span style="font-size: 20px;">🌐</span>
      <h1>Chakravyuh — Synthetic Geospatial Intelligence</h1>
    </div>
    <div class="stats-bar">
      <div class="stat-pill">
        <span class="label">Total Hit Points</span>
        <span class="val highlight-cyan">{total_hits:,}</span>
      </div>
      <div class="stat-pill">
        <span class="label">Fraud / Mule Hits</span>
        <span class="val highlight-rose">{total_fraud:,}</span>
      </div>
      <div class="stat-pill">
        <span class="label">ATM Terminals</span>
        <span class="val">{total_atm:,}</span>
      </div>
      <div class="stat-pill">
        <span class="label">Simulated Volume</span>
        <span class="val">₹{total_volume_inr:,.0f}</span>
      </div>
    </div>
  </header>

  <div class="main-container">
    <div id="map"></div>

    <div class="controls-panel">
      <div class="panel-title">
        <span>Heatmap Layer Filter</span>
        <span style="font-size: 11px; color: var(--accent-cyan);">Live Sync</span>
      </div>

      <div class="btn-group">
        <button class="layer-btn active" id="btn-all" onclick="switchLayer('all')">
          <span>🔥 All Transaction Hits</span>
          <span style="font-size: 11px; opacity: 0.8;">{total_hits}</span>
        </button>
        <button class="layer-btn rose" id="btn-fraud" onclick="switchLayer('fraud')">
          <span>🚨 Fraud & Mule Rings</span>
          <span style="font-size: 11px; opacity: 0.8;">{total_fraud}</span>
        </button>
        <button class="layer-btn" id="btn-atm" onclick="switchLayer('atm')">
          <span>🏧 ATM Cashout Clusters</span>
          <span style="font-size: 11px; opacity: 0.8;">{total_atm}</span>
        </button>
      </div>

      <div class="slider-container">
        <div class="slider-label">
          <span>Heat Blur Radius</span>
          <span id="radius-val">22px</span>
        </div>
        <input type="range" min="10" max="45" value="22" id="radius-slider" oninput="updateRadius(this.value)">
      </div>

      <div class="slider-container" style="margin-top: 10px;">
        <div class="slider-label">
          <span>Intensity Multiplier</span>
          <span id="intensity-val">1.0x</span>
        </div>
        <input type="range" min="0.4" max="2.5" step="0.1" value="1.0" id="intensity-slider" oninput="updateIntensity(this.value)">
      </div>
    </div>

    <div class="legend">
      <div>Geospatial Hit Density</div>
      <div class="gradient-bar"></div>
      <div class="legend-labels">
        <span>Low (Retail)</span>
        <span>Medium</span>
        <span>High (Ring / ATM Burst)</span>
      </div>
    </div>
  </div>

  <script>
    // Embedded Data Arrays
    const dataAll = {json.dumps(all_points)};
    const dataFraud = {json.dumps(fraud_points)};
    const dataAtm = {json.dumps(atm_points)};
    const hotspotMarkersData = {json.dumps(hotspot_markers)};

    // Initialize Leaflet Map centered on India
    const map = L.map('map', {{
      center: [22.3511, 78.6677],
      zoom: 5,
      minZoom: 4,
      maxZoom: 15,
      zoomControl: false
    }});

    L.control.zoom({{ position: 'bottomleft' }}).addTo(map);

    // Dark Tile Layer (CartoDB Dark Matter)
    L.tileLayer('https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png', {{
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }}).addTo(map);

    // Heat Layer Options
    let currentRadius = 22;
    let currentIntensity = 1.0;
    let activeDataset = dataAll;

    let heatLayer = L.heatLayer(dataAll, {{
      radius: currentRadius,
      blur: 18,
      maxZoom: 12,
      max: 1.0,
      gradient: {{
        0.1: '#3b82f6',
        0.3: '#06b6d4',
        0.5: '#10b981',
        0.7: '#f59e0b',
        0.9: '#ef4444',
        1.0: '#ff0055'
      }}
    }}).addTo(map);

    // Hotspot Cluster Layer Group
    const markerGroup = L.layerGroup().addTo(map);

    function renderHotspotMarkers() {{
      markerGroup.clearLayers();
      hotspotMarkersData.forEach(h => {{
        const marker = L.circleMarker([h.lat, h.lng], {{
          radius: Math.min(14, Math.max(5, h.hit_count / 3)),
          fillColor: h.fraud_hit_count > 0 ? '#f43f5e' : '#06b6d4',
          color: '#ffffff',
          weight: 1.2,
          opacity: 0.9,
          fillOpacity: 0.6
        }});

        marker.bindPopup(`
          <div style="font-size: 13px; line-height: 1.5;">
            <strong style="color: #38bdf8;">${{h.city}} Hotspot</strong><br/>
            <span>Dominant: <b>${{h.dominant_type}}</b></span><br/>
            <span>Hits: <b>${{h.hit_count}}</b> (Fraud: <b style="color: #f43f5e">${{h.fraud_hit_count}}</b>)</span><br/>
            <span>Volume: <b>${{h.total_amount_inr}}</b></span><br/>
            <span>Avg Risk: <b>${{(h.avg_risk * 100).toFixed(1)}}%</b></span>
          </div>
        `);
        markerGroup.addLayer(marker);
      }});
    }}

    renderHotspotMarkers();

    // Layer Switcher
    function switchLayer(layerType) {{
      document.querySelectorAll('.layer-btn').forEach(btn => btn.classList.remove('active'));
      
      if (layerType === 'all') {{
        activeDataset = dataAll;
        document.getElementById('btn-all').classList.add('active');
      }} else if (layerType === 'fraud') {{
        activeDataset = dataFraud;
        document.getElementById('btn-fraud').classList.add('active');
      }} else if (layerType === 'atm') {{
        activeDataset = dataAtm;
        document.getElementById('btn-atm').classList.add('active');
      }}

      applyHeatLayer();
    }}

    function applyHeatLayer() {{
      if (heatLayer) {{
        map.removeLayer(heatLayer);
      }}

      // Apply intensity scaling
      const scaledData = activeDataset.map(p => [p[0], p[1], Math.min(1.0, p[2] * currentIntensity)]);

      heatLayer = L.heatLayer(scaledData, {{
        radius: currentRadius,
        blur: Math.max(10, Math.floor(currentRadius * 0.8)),
        maxZoom: 12,
        max: 1.0,
        gradient: {{
          0.1: '#3b82f6',
          0.3: '#06b6d4',
          0.5: '#10b981',
          0.7: '#f59e0b',
          0.9: '#ef4444',
          1.0: '#ff0055'
        }}
      }}).addTo(map);
    }}

    function updateRadius(val) {{
      currentRadius = parseInt(val, 10);
      document.getElementById('radius-val').innerText = currentRadius + 'px';
      applyHeatLayer();
    }}

    function updateIntensity(val) {{
      currentIntensity = parseFloat(val);
      document.getElementById('intensity-val').innerText = currentIntensity.toFixed(1) + 'x';
      applyHeatLayer();
    }}
  </script>
</body>
</html>
"""
    return html_content


# ─────────────────────────────────────────────────────────────────
# 7. HIGH-LEVEL API & PIPELINE INTEGRATION
# ─────────────────────────────────────────────────────────────────

def generate_synthetic_locations(
    n_hits: int = 2500,
    fraud_ratio: float = 0.15,
    seed: int = 42,
    profile: str = "demo",
    output_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Main entry point: Generates synthetic location hits, calculates heatmap grid
    cells, computes KDE density surface, and saves artifacts to disk.
    """
    engine = SyntheticLocationEngine(seed=seed)
    hits = engine.generate_location_hits(n_hits=n_hits, fraud_ratio=fraud_ratio, profile=profile)

    # Compute binned grid heatmaps for multiple views
    heatmap_all = HeatmapEngine.compute_grid_heatmap(hits, filter_mode="ALL_HITS")
    heatmap_fraud = HeatmapEngine.compute_grid_heatmap(hits, filter_mode="FRAUD_ONLY")
    heatmap_atm = HeatmapEngine.compute_grid_heatmap(hits, filter_mode="ATM_CASHOUTS")

    # Continuous KDE surface
    kde_surface = HeatmapEngine.compute_continuous_kde(hits, bandwidth_km=12.0)

    # Convert to serialized dicts
    hits_data = [asdict(h) for h in hits]
    grid_all_data = [asdict(c) for c in heatmap_all]
    grid_fraud_data = [asdict(c) for c in heatmap_fraud]
    grid_atm_data = [asdict(c) for c in heatmap_atm]

    leaflet_points_all = to_leaflet_heat_points(hits)
    geojson_data = to_geojson_feature_collection(hits)
    html_visualization = generate_interactive_heatmap_html(hits, heatmap_all)

    results = {
        "metadata": {
            "total_hits": len(hits),
            "total_fraud_hits": sum(1 for h in hits if h.is_fraud),
            "total_atm_hits": sum(1 for h in hits if h.hit_type == "atm_cashout"),
            "total_volume_inr": sum(h.amount_inr for h in hits),
            "profile": profile,
            "seed": seed,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "hits": hits_data,
        "heatmap_grid": {
            "all": grid_all_data,
            "fraud": grid_fraud_data,
            "atm": grid_atm_data,
        },
        "leaflet_points": leaflet_points_all,
        "kde_surface": kde_surface,
        "geojson": geojson_data,
        "html_visualization": html_visualization,
    }

    if output_dir:
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # 1. Full JSON payload
        with open(output_dir / "locations.json", "w", encoding="utf-8") as f:
            json.dump(hits_data, f, indent=2)

        # 2. Heatmap Summary JSON (optimized for frontend/API dashboard)
        heatmap_summary = {
            "metadata": results["metadata"],
            "heatmap_grid": results["heatmap_grid"],
            "leaflet_points": results["leaflet_points"],
            "kde_surface": results["kde_surface"],
        }
        with open(output_dir / "heatmap_locations.json", "w", encoding="utf-8") as f:
            json.dump(heatmap_summary, f, indent=2)

        # 3. GeoJSON FeatureCollection
        with open(output_dir / "locations.geojson", "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, indent=2)

        # 4. Interactive HTML Dashboard
        with open(output_dir / "heatmap_dashboard.html", "w", encoding="utf-8") as f:
            f.write(html_visualization)

        # 5. Also sync to root data/<profile>/ and data/<profile>/outputs/ for backend
        try:
            root_data_dir = Path(__file__).resolve().parent.parent / "data" / profile
            root_outputs_dir = root_data_dir / "outputs"
            root_data_dir.mkdir(parents=True, exist_ok=True)
            root_outputs_dir.mkdir(parents=True, exist_ok=True)

            with open(root_data_dir / "locations.json", "w", encoding="utf-8") as f:
                json.dump(hits_data, f, indent=2)
            with open(root_data_dir / "heatmap_locations.json", "w", encoding="utf-8") as f:
                json.dump(heatmap_summary, f, indent=2)
            with open(root_outputs_dir / "heatmap_locations.json", "w", encoding="utf-8") as f:
                json.dump(heatmap_summary, f, indent=2)
            with open(root_data_dir / "locations.geojson", "w", encoding="utf-8") as f:
                json.dump(geojson_data, f, indent=2)
        except Exception:
            pass

        print(f"  [geo] Saved location & heatmap artifacts to: {output_dir}")

    return results


# ─────────────────────────────────────────────────────────────────
# 8. CLI INTERFACE
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chakravyuh Synthetic Geospatial & Heatmap Engine")
    parser.add_argument("--generate", action="store_true", default=True, help="Generate synthetic locations")
    parser.add_argument("--profile", type=str, default="demo", choices=["demo", "train", "test"], help="Dataset profile")
    parser.add_argument("--hits", type=int, default=2500, help="Number of synthetic location hits to generate")
    parser.add_argument("--fraud-ratio", type=float, default=0.15, help="Ratio of fraud/mule ring hits")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic random seed")
    parser.add_argument("--out-dir", type=str, default="ml/data/demo", help="Output directory")
    parser.add_argument("--export-html", type=str, default=None, help="Directly export interactive HTML file")

    args = parser.parse_args()

    out_path = Path(args.out_dir)
    res = generate_synthetic_locations(
        n_hits=args.hits,
        fraud_ratio=args.fraud_ratio,
        seed=args.seed,
        profile=args.profile,
        output_dir=out_path,
    )

    if args.export_html:
        html_p = Path(args.export_html)
        html_p.parent.mkdir(parents=True, exist_ok=True)
        with open(html_p, "w", encoding="utf-8") as f:
            f.write(res["html_visualization"])
        print(f"[OK] Exported interactive HTML heatmap to: {html_p}")

    print(f"\n[OK] Generated {res['metadata']['total_hits']} synthetic locations:")
    print(f"     * Normal Hits: {res['metadata']['total_hits'] - res['metadata']['total_fraud_hits']}")
    print(f"     * Fraud Hits:  {res['metadata']['total_fraud_hits']}")
    print(f"     * ATM Hits:    {res['metadata']['total_atm_hits']}")
    print(f"     * Simulated INR Volume: INR {res['metadata']['total_volume_inr']:,.2f}")
    print(f"     * Heatmap Bins: {len(res['heatmap_grid']['all'])} grid clusters")
