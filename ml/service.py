"""
service.py  —  Chakravyuh ML FastAPI Microservice
=================================================
Exposes REST endpoints for on-demand ML operations:
- POST /pipeline/run        Run full pipeline for a profile
- POST /ouroboros/run       Execute N-round red vs blue adversarial battle
- POST /taint/trace         Dynamic proportional taint tracing (integer paise)
- POST /freeze/recommend    Dynamic min-cut freeze recommendation
- POST /recruits/predict    Recruitment risk prediction
- GET  /health              Healthcheck
"""

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

    # Request models
    class PipelineRequest(BaseModel):
        profile: str = "demo"
        geo: bool = False

    class OuroborosRequest(BaseModel):
        rounds: int = 3
        profile: str = "demo"
        seed: int = 42

    class TaintRequest(BaseModel):
        transactions: List[Dict[str, Any]]
        opening_balances: Dict[str, int]
        victim_txn_id: str
        as_of: Optional[str] = None

    class FreezeRequest(BaseModel):
        ring: Dict[str, Any]
        transactions: List[Dict[str, Any]]
        accounts: List[Dict[str, Any]]
        victim_txn_id: Optional[str] = None
        k: int = 3
        exclude: Optional[List[str]] = None
        as_of: Optional[str] = None

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "chakravyuh-ml"}

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

    @app.post("/taint/trace")
    def trace_taint_endpoint(req: TaintRequest):
        try:
            from taint import trace
            bal, taint, flows, victim_amt = trace(
                req.transactions, req.opening_balances, req.victim_txn_id, req.as_of
            )
            return {
                "status": "success",
                "victim_amount": victim_amt,
                "balances": bal,
                "taint": taint,
                "flows": [{"from": k[0], "to": k[1], "value": v} for k, v in flows.items()],
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/freeze/recommend")
    def recommend_freeze_endpoint(req: FreezeRequest):
        try:
            from freeze import recommend_freeze
            rec = recommend_freeze(
                ring=req.ring,
                transactions=req.transactions,
                accounts=req.accounts,
                victim_txn_id=req.victim_txn_id,
                k=req.k,
                exclude=req.exclude,
                as_of=req.as_of,
            )
            return {"status": "success", "recommendation": rec}
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
