from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable
import uuid

from .contracts import validate_feedback_record
from .director import Decision


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_feedback(
    *,
    pack: dict[str, Any],
    decision: Decision,
    delivered: bool | None,
    verified: bool | None,
    task_success: bool | None,
    observed_effect_ref: str | None = None,
    error_code: str | None = None,
    feedback_id_factory: Callable[[], str] | None = None,
    now: Callable[[], str] = _now_iso,
) -> dict[str, Any]:
    factory = feedback_id_factory or (lambda: f"BFR-{uuid.uuid4().hex}")
    scope = dict(pack.get("scope") or {})
    record = {
        "feedbackVersion": "1.0",
        "feedbackId": factory(),
        "decisionId": decision.decision_id,
        "packId": str(pack["packId"]),
        "source": "agent",
        "consumedRecordIds": list(pack.get("sourceRecordIds") or []),
        "decision": {
            "status": decision.status,
            "selectedCapability": decision.selected_capability,
            "selectedStrategy": decision.selected_strategy,
            "reasonCode": decision.reason_code,
        },
        "result": {
            "delivered": delivered,
            "verified": verified,
            "taskSuccess": task_success,
            "observedEffectRef": observed_effect_ref,
            "errorCode": error_code,
        },
        "scope": scope,
        "createdAt": now(),
    }
    validate_feedback_record(record)
    return record
