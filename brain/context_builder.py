from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .contracts import validate_brain_ready_record, validate_situation_pack


DEFAULT_REGISTRY = Path(__file__).resolve().parents[1] / "config" / "brain-capabilities-v1.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _pack_id(goal: dict[str, Any], observation: dict[str, Any], record_ids: list[str]) -> str:
    payload = json.dumps(
        {"goal": goal, "observedAt": observation.get("observedAt"), "records": record_ids},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return "BSP-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def load_registry(path: Path | str = DEFAULT_REGISTRY) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if int(value.get("schemaVersion", 0)) != 1 or not isinstance(value.get("capabilities"), dict):
        raise ValueError("brain_capability_registry_invalid")
    return value


def _semantic_platform(observation: dict[str, Any]) -> str:
    semantic = ((observation.get("content") or {}).get("semantic") or {})
    platform = str(semantic.get("platform") or "").strip().lower()
    if platform:
        return platform
    site_key = str((observation.get("scope") or {}).get("siteKey") or "").lower()
    if "youtube" in site_key:
        return "youtube"
    return "unknown"


def _semantic_situation(observation: dict[str, Any]) -> dict[str, Any]:
    content = observation.get("content") or {}
    semantic = content.get("semantic") or {}
    route = semantic.get("route") or {}
    controls = semantic.get("controls") or {}
    search = controls.get("searchInput") or {}
    surfaces = semantic.get("surfaces") or []
    search_results = any(
        isinstance(row, dict) and row.get("surface") == "search_results" for row in surfaces
    )
    browser_state = str((observation.get("bodyState") or {}).get("browserState") or "UNKNOWN")
    return {
        "platform": _semantic_platform(observation),
        "pageType": str(route.get("pageType") or "other"),
        "humanActive": browser_state == "HUMAN_CONTROL",
        "browserState": browser_state,
        "searchInput": {
            "available": search.get("available") is True,
            "visible": search.get("visible") is True,
            "active": search.get("active") is True,
            "actionRect": search.get("actionRect") if isinstance(search.get("actionRect"), dict) else None,
        },
        "searchResultsObserved": search_results,
        "liveObservation": bool((observation.get("freshness") or {}).get("liveRefreshSucceeded") is True),
    }


class ContextBuilder:
    """Builds compact BrainSituationPack objects without raw Human event timelines."""

    def __init__(self, registry: dict[str, Any] | None = None, *, now: Callable[[], str] = _now_iso):
        self.registry = registry or load_registry()
        self.now = now

    def build(
        self,
        *,
        goal: dict[str, Any],
        observation: dict[str, Any],
        task_policy: dict[str, Any],
        records: list[dict[str, Any]],
    ) -> dict[str, Any]:
        goal_type = str(goal.get("type") or "").strip()
        if not goal_type:
            raise ValueError("brain_goal_type_required")
        for record in records:
            validate_brain_ready_record(record)
        registry_capability = (self.registry.get("capabilities") or {}).get(goal_type)
        relevant = [
            record for record in records
            if ((record.get("semantic") or {}).get("capabilityCandidate") or {}).get("name") == goal_type
        ]
        record_ids = [str(record["recordId"]) for record in relevant]
        minimum = int((registry_capability or {}).get("minimumEvidenceRecords", 1))
        capabilities: list[dict[str, Any]] = []
        strategies: list[dict[str, Any]] = []
        expected_effects: list[dict[str, Any]] = []

        if registry_capability and len(relevant) >= minimum:
            confidence = max(
                float(((record.get("semantic") or {}).get("capabilityCandidate") or {}).get("confidence", 0))
                for record in relevant
            )
            capabilities.append({
                "name": goal_type,
                "autonomy": int(registry_capability.get("autonomy", 0)),
                "confidence": confidence,
                "evidenceRecordIds": record_ids,
            })
            configured_strategies = registry_capability.get("strategies") or {}
            for strategy_id, strategy_config in configured_strategies.items():
                supporting = [
                    record for record in relevant
                    if ((record.get("semantic") or {}).get("strategyCandidate") or {}).get("id") == strategy_id
                ]
                if not supporting:
                    continue
                support_ids = [str(record["recordId"]) for record in supporting]
                human_count = sum(
                    1 for record in supporting if (record.get("provenance") or {}).get("source") == "human"
                )
                effect_success = sum(
                    1 for record in supporting
                    if ((record.get("semantic") or {}).get("effect") or {}).get("pageType") == "search"
                )
                strategies.append({
                    "id": strategy_id,
                    "capability": goal_type,
                    "steps": list(strategy_config.get("semanticSteps") or []),
                    "humanPreference": min(1.0, human_count / max(1, len(supporting))),
                    "successRate": min(1.0, effect_success / max(1, len(supporting))),
                    "evidenceRecordIds": support_ids,
                })
                expected = strategy_config.get("expectedEffect") or {}
                expected_effects.append({
                    "capability": goal_type,
                    "effectType": str(expected.get("effectType") or "page_state"),
                    "expected": dict(expected.get("expected") or {}),
                    "evidenceRecordIds": support_ids,
                })

        situation = _semantic_situation(observation)
        environment = observation.get("environment") or {}
        policy_class = str(task_policy.get("policyClass") or "HUMAN_APPROVED")
        policy_eligible = task_policy.get("eligible") is True
        configured_allowed = list((registry_capability or {}).get("allowedActions") or [])
        configured_blocked = list((registry_capability or {}).get("blockedActions") or [])
        if policy_class == "RESTRICTED":
            policy_eligible = False
        pack = {
            "packVersion": "1.0",
            "packId": _pack_id(goal, observation, record_ids),
            "goal": {
                "type": goal_type,
                "parameters": dict(goal.get("parameters") or {}),
                **({"directiveId": str(goal["directiveId"])} if goal.get("directiveId") else {}),
            },
            "scope": {
                "browserInstanceId": str((observation.get("scope") or {}).get("browserInstanceId") or ""),
            },
            "situation": situation,
            "capabilities": capabilities,
            "strategies": strategies,
            "experiences": [
                {"recordId": record_id, "relevance": 1.0} for record_id in record_ids[:12]
            ],
            "expectedEffects": expected_effects,
            "policy": {
                "class": policy_class,
                "eligible": policy_eligible,
                "allowedActions": configured_allowed if policy_eligible else [],
                "blockedActions": configured_blocked,
                **({"reason": str(task_policy.get("reason"))} if task_policy.get("reason") else {}),
            },
            "environment": {
                "eligible": environment.get("eligible") is True,
                "browserState": str(environment.get("browserState") or situation["browserState"]),
                "healthRefs": list(environment.get("reasons") or []),
            },
            "sourceRecordIds": record_ids,
            "createdAt": self.now(),
        }
        validate_situation_pack(pack)
        return pack
