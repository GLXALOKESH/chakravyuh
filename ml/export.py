"""
export.py — Backend Hand-off Exporter
======================================
Exports processed data, predictions, detected rings, and graph networks
to data/ adhering strictly to BACKEND_INTERFACE.md JSON schemas.
"""

import json
from pathlib import Path
from typing import List, Dict, Any
from ml.config import DATA_DIR


def export_backend_payloads(
    accounts: List[Dict[str, Any]],
    transactions: List[Dict[str, Any]],
    predictions: List[Dict[str, Any]],
    detected_rings: List[Dict[str, Any]],
    graph_network: Dict[str, Any],
    target_dir: Path = DATA_DIR,
):
    """
    Saves all standard datasets into data/*.json for Express backend consumption.
    """
    target_dir.mkdir(parents=True, exist_ok=True)

    files = {
        "accounts.json": accounts,
        "transactions.json": transactions,
        "predictions.json": predictions,
        "detected_rings.json": detected_rings,
        "graph_network.json": graph_network,
    }

    for filename, payload in files.items():
        filepath = target_dir / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print(f"  [export] Exported {len(payload) if isinstance(payload, list) else len(payload.get('nodes', []))} items -> {filepath.name}")

    print(f"\n[OK] All backend handoff files exported to {target_dir}")
