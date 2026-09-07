from __future__ import annotations

from typing import Any


class BrainContractError(ValueError):
    pass


def _require_object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BrainContractError(f"{name}_object_required")
    return value


def _require_keys(value: dict[str, Any], keys: set[str], name: str) -> None:
    missing = sorted(keys.difference(value))
    if missing:
        raise BrainContractError(f"{name}_missing:{','.join(missing)}")


def _walk_keys(value: Any):
    if isinstance(value, dict):
        for key, row in value.items():
            yield str(key)
            yield from _walk_keys(row)
    elif isinstance(value, list):
        for row in value:
            yield from _walk_keys(row)


def validate_brain_ready_record(record: dict[str, Any]) -> dict[str, Any]:
    value = _require_object(record, "brain_ready_record")
    _require_keys(value, {
        "schemaVersion", "recordType", "recordId", "recordClass", "producer", "scope",
        "provenance", "facts", "inferences", "semantic", "quality", "createdAt",
    }, "brain_ready_record")
    if value["schemaVersion"] != "1.0" or value["recordType"] != "brain_ready_record":
        raise BrainContractError("brain_ready_record_version_invalid")
    if value["recordClass"] not in {
        "demonstration", "pattern", "habit_candidate", "capability_candidate",
        "content_semantic", "effect_evidence", "knowledge_candidate",
    }:
        raise BrainContractError("brain_ready_record_class_invalid")
    provenance = _require_object(value["provenance"], "brain_ready_provenance")
    _require_keys(provenance, {"source", "rawEvidenceRefs", "derivedFrom", "immutable"}, "brain_ready_provenance")
    if provenance["immutable"] is not True:
        raise BrainContractError("brain_ready_record_must_be_immutable")
    if provenance["source"] == "human" and not provenance.get("rawEvidenceRefs"):
        raise BrainContractError("human_record_evidence_required")
    if provenance["source"] == "agent" and int((value.get("quality") or {}).get("humanSampleCount", 0)) > 0:
        raise BrainContractError("agent_record_cannot_claim_human_samples")
    forbidden_authority = {"autonomy", "permission", "policyeligible", "executionpermission"}
    normalized = {key.replace("_", "").replace("-", "").lower() for key in _walk_keys(value)}
    leaked = sorted(forbidden_authority.intersection(normalized))
    if leaked:
        raise BrainContractError(f"producer_authority_forbidden:{','.join(leaked)}")
    for inference in value.get("inferences") or []:
        row = _require_object(inference, "brain_ready_inference")
        _require_keys(row, {"type", "value", "confidence", "method", "evidenceRefs"}, "brain_ready_inference")
        confidence = float(row["confidence"])
        if confidence < 0 or confidence > 1 or not row["evidenceRefs"]:
            raise BrainContractError("brain_ready_inference_invalid")
    return value


def validate_situation_pack(pack: dict[str, Any]) -> dict[str, Any]:
    value = _require_object(pack, "brain_situation_pack")
    _require_keys(value, {
        "packVersion", "packId", "goal", "situation", "capabilities", "strategies",
        "experiences", "expectedEffects", "policy", "environment", "sourceRecordIds", "createdAt",
    }, "brain_situation_pack")
    if value["packVersion"] != "1.0":
        raise BrainContractError("brain_situation_pack_version_invalid")
    policy = _require_object(value["policy"], "brain_policy")
    _require_keys(policy, {"class", "eligible", "allowedActions", "blockedActions"}, "brain_policy")
    if policy["class"] not in {"SAFE_AUTO", "HUMAN_APPROVED", "RESTRICTED"}:
        raise BrainContractError("brain_policy_class_invalid")
    environment = _require_object(value["environment"], "brain_environment")
    _require_keys(environment, {"eligible", "browserState"}, "brain_environment")
    for capability in value.get("capabilities") or []:
        row = _require_object(capability, "brain_capability")
        _require_keys(row, {"name", "autonomy", "confidence", "evidenceRecordIds"}, "brain_capability")
        autonomy = int(row["autonomy"])
        if autonomy < 0 or autonomy > 4:
            raise BrainContractError("brain_capability_autonomy_invalid")
    return value


def validate_feedback_record(record: dict[str, Any]) -> dict[str, Any]:
    value = _require_object(record, "brain_feedback_record")
    _require_keys(value, {
        "feedbackVersion", "feedbackId", "decisionId", "packId", "source",
        "consumedRecordIds", "decision", "result", "createdAt",
    }, "brain_feedback_record")
    if value["feedbackVersion"] != "1.0" or value["source"] != "agent":
        raise BrainContractError("brain_feedback_version_or_source_invalid")
    decision = _require_object(value["decision"], "brain_feedback_decision")
    if decision.get("status") not in {"EXECUTE", "WAIT", "REQUEST_EVIDENCE", "REPLAN", "REJECT"}:
        raise BrainContractError("brain_feedback_decision_status_invalid")
    result = _require_object(value["result"], "brain_feedback_result")
    _require_keys(result, {"delivered", "verified", "taskSuccess"}, "brain_feedback_result")
    return value
