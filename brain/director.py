from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable
import uuid

from .contracts import validate_situation_pack


@dataclass
class BrainSession:
    stage: str = "INIT"
    decision_count: int = 0


@dataclass(frozen=True)
class Decision:
    decision_id: str
    status: str
    reason_code: str
    selected_capability: str | None = None
    selected_strategy: str | None = None
    body_step: dict[str, Any] | None = None
    task_success: bool | None = None


class Director:
    """Deterministic Director v1 for the first proven capability: youtube.search.

    It consumes only BrainSituationPack and emits at most one BODY step per decision.
    """

    def __init__(self, *, id_factory: Callable[[], str] | None = None):
        self.id_factory = id_factory or (lambda: f"DEC-{uuid.uuid4().hex}")

    @staticmethod
    def goal_achieved(pack: dict[str, Any]) -> bool:
        situation = pack.get("situation") or {}
        return (
            pack.get("goal", {}).get("type") == "youtube.search"
            and situation.get("pageType") == "search"
            and situation.get("searchResultsObserved") is True
        )

    @staticmethod
    def _capability(pack: dict[str, Any], name: str) -> dict[str, Any] | None:
        for row in pack.get("capabilities") or []:
            if row.get("name") == name:
                return row
        return None

    @staticmethod
    def _strategy(pack: dict[str, Any], capability: str, strategy_id: str) -> dict[str, Any] | None:
        for row in pack.get("strategies") or []:
            if row.get("capability") == capability and row.get("id") == strategy_id:
                return row
        return None

    def decide(self, pack: dict[str, Any], session: BrainSession) -> Decision:
        validate_situation_pack(pack)
        session.decision_count += 1
        decision_id = self.id_factory()
        policy = pack.get("policy") or {}
        environment = pack.get("environment") or {}
        situation = pack.get("situation") or {}
        goal = pack.get("goal") or {}
        goal_type = str(goal.get("type") or "")

        if policy.get("class") == "RESTRICTED" or policy.get("eligible") is not True:
            return Decision(decision_id, "REJECT", "policy_not_eligible")
        if environment.get("eligible") is not True:
            return Decision(decision_id, "WAIT", "environment_not_eligible")
        if situation.get("humanActive") is True or situation.get("browserState") == "HUMAN_CONTROL":
            return Decision(decision_id, "WAIT", "human_control_active")
        if self.goal_achieved(pack):
            return Decision(decision_id, "WAIT", "goal_effect_observed", task_success=True)
        if goal_type != "youtube.search":
            return Decision(decision_id, "REQUEST_EVIDENCE", "unsupported_goal")

        capability = self._capability(pack, goal_type)
        if capability is None:
            return Decision(decision_id, "REQUEST_EVIDENCE", "capability_evidence_missing")
        if int(capability.get("autonomy", 0)) < 2:
            return Decision(decision_id, "WAIT", "capability_autonomy_insufficient", selected_capability=goal_type)
        strategy = self._strategy(pack, goal_type, "SEARCH_ENTER")
        if strategy is None:
            return Decision(
                decision_id,
                "REQUEST_EVIDENCE",
                "strategy_evidence_missing",
                selected_capability=goal_type,
            )

        parameters = goal.get("parameters") or {}
        query = str(parameters.get("query") or "")
        if not query:
            return Decision(
                decision_id,
                "REJECT",
                "goal_query_required",
                selected_capability=goal_type,
                selected_strategy="SEARCH_ENTER",
            )

        if session.stage == "INIT":
            search = situation.get("searchInput") or {}
            rect = search.get("actionRect") if isinstance(search.get("actionRect"), dict) else None
            if search.get("available") is not True or search.get("visible") is not True or not rect:
                return Decision(
                    decision_id,
                    "REQUEST_EVIDENCE",
                    "search_input_not_observed",
                    selected_capability=goal_type,
                    selected_strategy="SEARCH_ENTER",
                )
            try:
                x = float(rect["x"]) + float(rect["width"]) / 2.0
                y = float(rect["y"]) + float(rect["height"]) / 2.0
            except (KeyError, TypeError, ValueError):
                return Decision(
                    decision_id,
                    "REQUEST_EVIDENCE",
                    "search_input_rect_invalid",
                    selected_capability=goal_type,
                    selected_strategy="SEARCH_ENTER",
                )
            return Decision(
                decision_id,
                "EXECUTE",
                "type_search_query",
                selected_capability=goal_type,
                selected_strategy="SEARCH_ENTER",
                body_step={
                    "kind": "motor",
                    "intent": {
                        "type": "typeText",
                        "x": x,
                        "y": y,
                        "width": float(rect.get("width") or 12),
                        "height": float(rect.get("height") or 12),
                        "role": "search_input",
                        "text": query,
                    },
                },
            )

        if session.stage == "TEXT_ENTERED":
            return Decision(
                decision_id,
                "EXECUTE",
                "submit_search",
                selected_capability=goal_type,
                selected_strategy="SEARCH_ENTER",
                body_step={"kind": "motor", "intent": {"type": "pressKey", "key": "Enter"}},
            )
        if session.stage == "SUBMITTED":
            return Decision(
                decision_id,
                "WAIT",
                "expected_effect_pending",
                selected_capability=goal_type,
                selected_strategy="SEARCH_ENTER",
            )
        return Decision(decision_id, "REPLAN", "brain_session_stage_invalid")

    @staticmethod
    def advance(session: BrainSession, decision: Decision, body_result: dict[str, Any]) -> None:
        if decision.status != "EXECUTE" or decision.body_step is None:
            return
        execution = body_result.get("execution") or {}
        if execution.get("completed") is not True:
            return
        intent_type = ((decision.body_step.get("intent") or {}).get("type"))
        if session.stage == "INIT" and intent_type == "typeText":
            session.stage = "TEXT_ENTERED"
        elif session.stage == "TEXT_ENTERED" and intent_type == "pressKey":
            session.stage = "SUBMITTED"
