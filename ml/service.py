"""
service.py  —  Chakravyuh ML FastAPI Microservice
=================================================
Exposes REST endpoints for on-demand ML operations:
- POST /taint               Live proportional taint tracing (TRD §3, §7.6, §7.10)
- POST /mincut              Live min-cut freeze optimization (TRD §3, §7.7, §7.10)
- POST /pipeline/run        Run full pipeline for a profile
- POST /ouroboros/run       Execute N-round red vs blue adversarial battle
- GET  /health              Healthcheck
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

ML_DIR = Path(__file__).resolve().parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


def _load_data(profile="demo"):
    data_dir = ML_DIR / "data" / profile
    accounts, txns, rings = [], [], []
    if (data_dir / "accounts.json").exists():
        with open(data_dir / "accounts.json", "r", encoding="utf-8") as f:
            accounts = json.load(f)
    if (data_dir / "transactions.json").exists():
        with open(data_dir / "transactions.json", "r", encoding="utf-8") as f:
            txns = json.load(f)
    if (data_dir / "outputs" / "rings.json").exists():
        with open(data_dir / "outputs" / "rings.json", "r", encoding="utf-8") as f:
            rings = json.load(f)
    return accounts, txns, rings


if FASTAPI_AVAILABLE:
    app = FastAPI(
        title="Chakravyuh Fraud Intelligence ML API",
        description="FastAPI service for money mule detection, taint tracing, and freeze optimization.",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Request models matching Express client
    class TaintRequest(BaseModel):
        ring_id: Optional[str] = "RING01"
        victim_txn_id: Optional[str] = None
        as_of: Optional[str] = None
        transactions: Optional[List[Dict[str, Any]]] = None
        opening_balances: Optional[Dict[str, int]] = None

    class FreezeRequest(BaseModel):
        ring_id: Optional[str] = "RING01"
        victim_txn_id: Optional[str] = None
        k: int = 3
        exclude: Optional[List[str]] = None
        as_of: Optional[str] = None
        ring: Optional[Dict[str, Any]] = None
        transactions: Optional[List[Dict[str, Any]]] = None
        accounts: Optional[List[Dict[str, Any]]] = None

    class PipelineRequest(BaseModel):
        profile: str = "demo"
        geo: bool = False

    class OuroborosRequest(BaseModel):
        rounds: int = 3
        profile: str = "demo"
        seed: int = 42

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "chakravyuh-ml"}

    @app.post("/taint")
    def taint_endpoint(req: TaintRequest):
        try:
            from taint import trace
            accounts, txns, rings = _load_data("demo")
            transactions = req.transactions or txns
            
            # Find ring
            ring = next((r for r in rings if r.get("_id") == req.ring_id or r.get("ring_id") == req.ring_id), None)
            ring_members = set(ring["member_ids"]) if ring else {a["_id"] for a in accounts}

            # Opening balances
            if req.opening_balances:
                open_bal = req.opening_balances
            else:
                open_bal = {a["_id"]: a["opening_balance"] for a in accounts}

            # Victim txn id
            victim_txn = req.victim_txn_id
            if not victim_txn and ring and ring.get("victim_txn_ids"):
                victim_txn = ring["victim_txn_ids"][0]
            if not victim_txn:
                # Find first fraud txn
                for t in transactions:
                    if t.get("is_fraud") and t["to"] in ring_members:
                        victim_txn = t["_id"]
                        break

            bal, taint_map, flows, victim_amt = trace(transactions, open_bal, victim_txn, req.as_of)

            # Build TaintPayload response shape matching TRD §8
            account_rows = []
            for aid in ring_members:
                t_val = taint_map.get(aid, 0)
                b_val = bal.get(aid, 0)
                account_rows.append({
                    "id": aid,
                    "balance": b_val,
                    "tainted": t_val,
                    "lien": min(t_val, max(b_val, 0)),
                })

            lost_to_cash = taint_map.get("CASH", 0)
            links = [{"source": u, "target": v, "value": val} for (u, v), val in flows.items() if val > 0]

            return {
                "victim_amount": victim_amt,
                "as_of": req.as_of,
                "accounts": account_rows,
                "lost_to_cash": lost_to_cash,
                "links": links,
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/mincut")
    def mincut_endpoint(req: FreezeRequest):
        try:
            from freeze import recommend_freeze
            accounts, txns, rings = _load_data("demo")
            ring = req.ring or next((r for r in rings if r.get("_id") == req.ring_id or r.get("ring_id") == req.ring_id), None)
            if not ring:
                raise HTTPException(status_code=404, detail=f"Ring {req.ring_id} not found")

            transactions = req.transactions or txns
            acc_list = req.accounts or accounts

            victim_txn = req.victim_txn_id
            if not victim_txn and ring.get("victim_txn_ids"):
                victim_txn = ring["victim_txn_ids"][0]

            rec = recommend_freeze(
                ring=ring,
                transactions=transactions,
                accounts=acc_list,
                victim_txn_id=victim_txn,
                k=req.k,
                exclude=req.exclude,
                as_of=req.as_of,
            )
            return rec
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/pipeline/run")
    def run_pipeline_endpoint(req: PipelineRequest):
        try:
            from pipeline import run_pipeline
            result = run_pipeline(profile=req.profile, geo=req.geo)
            return {"status": "success", "result": result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/ouroboros/run")
    def run_ouroboros_endpoint(req: OuroborosRequest):
        try:
            from loop import run_ouroboros
            result = run_ouroboros(n_rounds=req.rounds, profile=req.profile, seed=req.seed)
            return {"status": "success", "result": result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

else:
    app = None


if __name__ == "__main__":
    if not FASTAPI_AVAILABLE:
        print("FastAPI / Uvicorn not installed. To run the ML REST service:")
        print("    pip install fastapi uvicorn")
    else:
        import uvicorn
        uvicorn.run("service:app", host="0.0.0.0", port=8000, reload=True)
