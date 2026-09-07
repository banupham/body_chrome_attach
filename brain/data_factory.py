from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from .contracts import validate_brain_ready_record
from .store import BrainStore


COMPILER_ID = "local-data-factory-v1"


class EvidenceInputError(ValueError):
    pass


def _record_id(evidence_id: str) -> str:
    digest = hashlib.sha256(f"{COMPILER_ID}|{evidence_id}".encode("utf-8")).hexdigest()[:24]
    return f"BRR-{digest}"


def _page_type(state: dict[str, Any]) -> str | None:
    route = (state or {}).get("route") or {}
    value = str(route.get("pageType") or "").strip()
    return value or None


def verify_chain_links(rows: Iterable[dict[str, Any]]) -> None:
    previous: str | None = None
    for index, row in enumerate(rows, start=1):
        if int(row.get("schemaVersion", 0)) != 1:
            raise EvidenceInputError(f"evidence_schema_unsupported:{index}")
        if (row.get("previousHash") or None) != previous:
            raise EvidenceInputError(f"evidence_chain_link_broken:{index}")
        record_hash = str(row.get("recordHash") or "").strip()
        if not record_hash:
            raise EvidenceInputError(f"evidence_record_hash_required:{index}")
        previous = record_hash


def compile_youtube_search(evidence: dict[str, Any]) -> dict[str, Any]:
    if evidence.get("source") != "human":
        raise EvidenceInputError("data_factory_human_evidence_required")
    provenance = evidence.get("provenance") or {}
    if provenance.get("trustedInput") is not True:
        raise EvidenceInputError("data_factory_trusted_input_required")
    action = evidence.get("action") or {}
    if action.get("type") != "youtube.search" or action.get("trigger") != "keyboard_enter":
        raise EvidenceInputError("data_factory_youtube_search_evidence_required")
    evidence_id = str(evidence.get("evidenceId") or "").strip()
    if not evidence_id:
        raise EvidenceInputError("data_factory_evidence_id_required")
    identity = evidence.get("identity") or {}
    company_id = str(identity.get("companyId") or "").strip()
    device_id = str(identity.get("deviceId") or "").strip()
    if not company_id or not device_id:
        raise EvidenceInputError("data_factory_scope_required")

    before = evidence.get("beforeState") or {}
    after = evidence.get("afterState") or {}
    effect = evidence.get("observedEffect") or {}
    before_type = _page_type(before)
    after_type = _page_type(after)
    facts: list[dict[str, Any]] = [
        {"type": "submit_key", "value": "Enter", "evidenceRefs": [evidence_id]},
    ]
    if before_type:
        facts.append({"type": "before_page_type", "value": before_type, "evidenceRefs": [evidence_id]})
    if after_type:
        facts.append({"type": "after_page_type", "value": after_type, "evidenceRefs": [evidence_id]})
    if effect.get("searchResultsObserved") is True:
        facts.append({"type": "search_results_observed", "value": True, "evidenceRefs": [evidence_id]})

    confidence = 0.98 if after_type == "search" else 0.90
    record = {
        "schemaVersion": "1.0",
        "recordType": "brain_ready_record",
        "recordId": _record_id(evidence_id),
        "recordClass": "demonstration",
        "producer": {"kind": "semantic_compiler", "id": COMPILER_ID},
        "scope": {
            "companyId": company_id,
            "deviceId": device_id,
            "browserInstanceId": str(identity.get("browserInstanceId") or ""),
            "extensionInstanceId": str(identity.get("extensionInstanceId") or ""),
            "platform": "youtube",
        },
        "provenance": {
            "source": "human",
            "sessionId": str(provenance.get("sessionId") or ""),
            "rawEvidenceRefs": [evidence_id],
            "derivedFrom": [],
            "immutable": True,
        },
        "facts": facts,
        "inferences": [
            {
                "type": "capability_candidate",
                "value": "youtube.search",
                "confidence": confidence,
                "method": "deterministic_semantic_compiler",
                "evidenceRefs": [evidence_id],
            },
            {
                "type": "strategy_candidate",
                "value": "SEARCH_ENTER",
                "confidence": confidence,
                "method": "deterministic_semantic_compiler",
                "evidenceRefs": [evidence_id],
            },
        ],
        "semantic": {
            "situation": {"platform": "youtube", "pageType": before_type or "other"},
            "capabilityCandidate": {"name": "youtube.search", "confidence": confidence},
            "strategyCandidate": {
                "id": "SEARCH_ENTER",
                "steps": ["focus_search", "type_query", "press_enter"],
                "confidence": confidence,
            },
            "effect": {
                "pageType": after_type or "other",
                "searchResultsObserved": effect.get("searchResultsObserved") is True,
            },
        },
        "quality": {"overallConfidence": confidence, "humanSampleCount": 1, "agentSampleCount": 0},
        "createdAt": str(evidence.get("recordedAt") or ""),
    }
    validate_brain_ready_record(record)
    return record


class DataFactory:
    """Deterministic semantic compiler. It has no BODY/controller authority."""

    def __init__(self, store: BrainStore):
        self.store = store

    def compile(self, evidence: dict[str, Any]) -> dict[str, Any] | None:
        action = evidence.get("action") or {}
        if evidence.get("source") == "human" and action.get("type") == "youtube.search":
            return compile_youtube_search(evidence)
        return None

    def ingest_rows(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        verify_chain_links(rows)
        compiled = stored = replayed = skipped = 0
        for evidence in rows:
            record = self.compile(evidence)
            if record is None:
                skipped += 1
                continue
            compiled += 1
            result = self.store.put_record(record)
            stored += int(result["stored"] is True)
            replayed += int(result["replayed"] is True)
        return {"compiled": compiled, "stored": stored, "replayed": replayed, "skipped": skipped}

    def ingest_directory(self, evidence_root: Path | str) -> dict[str, int]:
        root = Path(evidence_root)
        totals = {"files": 0, "compiled": 0, "stored": 0, "replayed": 0, "skipped": 0}
        if not root.exists():
            return totals
        for pathname in sorted(root.rglob("evidence.jsonl")):
            rows = [json.loads(line) for line in pathname.read_text(encoding="utf-8").splitlines() if line.strip()]
            if not rows:
                continue
            result = self.ingest_rows(rows)
            totals["files"] += 1
            for key in ("compiled", "stored", "replayed", "skipped"):
                totals[key] += result[key]
        return totals
