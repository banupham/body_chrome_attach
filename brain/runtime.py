from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from .context_builder import ContextBuilder
from .data_factory import DataFactory
from .director import BrainSession, Decision, Director
from .feedback import create_feedback
from .store import BrainStore


class BrainRuntimeError(RuntimeError):
    pass


class GoalRunner:
    """Bounded Brain execution loop: observe -> decide one step -> BODY -> evaluate."""

    def __init__(
        self,
        body_client,
        store: BrainStore,
        *,
        evidence_root: Path | str,
        context_builder: ContextBuilder | None = None,
        director: Director | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.body = body_client
        self.store = store
        self.evidence_root = Path(evidence_root)
        self.factory = DataFactory(store)
        self.builder = context_builder or ContextBuilder()
        self.director = director or Director()
        self.sleep = sleep

    def refresh_data_factory(self) -> dict[str, int]:
        return self.factory.ingest_directory(self.evidence_root)

    def _ready_browser(self) -> str:
        readiness = self.body.readiness()
        for row in readiness.get("browsers") or []:
            if row.get("state") == "READY":
                return str(row["browserInstanceId"])
        raise BrainRuntimeError(f"guardian_not_ready:{readiness.get('state', 'UNKNOWN')}")

    def _feedback(
        self,
        pack: dict[str, Any],
        decision: Decision,
        *,
        delivered: bool | None,
        verified: bool | None,
        task_success: bool | None,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        record = create_feedback(
            pack=pack,
            decision=decision,
            delivered=delivered,
            verified=verified,
            task_success=task_success,
            error_code=error_code,
        )
        self.store.put_feedback(record)
        return record

    def _finish_task(self, task_id: str, state: str, payload: Any) -> dict[str, Any]:
        if state == "COMPLETED":
            return dict(self.body.request("TASK_COMPLETE", taskId=task_id, result=payload).get("result") or {})
        if state == "FAILED":
            return dict(self.body.request("TASK_FAIL", taskId=task_id, error=payload).get("result") or {})
        return dict(self.body.request("TASK_CANCEL", taskId=task_id, reason=payload).get("result") or {})

    def run_youtube_search(
        self,
        query: str,
        *,
        max_decisions: int = 8,
        effect_wait_seconds: float = 0.35,
    ) -> dict[str, Any]:
        query = str(query)
        if not query:
            raise BrainRuntimeError("youtube_search_query_required")
        if max_decisions < 1 or max_decisions > 32:
            raise BrainRuntimeError("brain_max_decisions_out_of_range")

        factory_result = self.refresh_data_factory()
        records = self.store.list_records(capability="youtube.search", platform="youtube")
        if not records:
            return {
                "status": "REQUEST_EVIDENCE",
                "reason": "youtube_search_human_demonstration_required",
                "dataFactory": factory_result,
            }

        browser_id = self._ready_browser()
        initial = self.body.observe(browser_instance_id=browser_id)
        tab_id = int((initial.get("scope") or {}).get("tabId"))
        goal = {"type": "youtube.search", "parameters": {"query": query}}
        task = self.body.task_create({
            "browserInstanceId": browser_id,
            "primaryTabId": tab_id,
            "tabIds": [tab_id],
            "capability": "youtube.search",
            "policyClass": "SAFE_AUTO",
            "goal": {"capability": "youtube.search", "parameters": {"query": query}},
        })
        if task.get("state") != "READY":
            return {"status": "WAIT", "reason": f"task_not_ready:{task.get('state')}", "task": task}
        task = self.body.task_start(str(task["taskId"]))
        session = BrainSession()
        feedback_ids: list[str] = []

        try:
            for _ in range(max_decisions):
                observation = self.body.observe(task_id=str(task["taskId"]))
                pack = self.builder.build(
                    goal=goal,
                    observation=observation,
                    task_policy=dict(task.get("policy") or {}),
                    records=records,
                )
                decision = self.director.decide(pack, session)

                if decision.task_success is True:
                    feedback = self._feedback(
                        pack,
                        decision,
                        delivered=None,
                        verified=True,
                        task_success=True,
                    )
                    feedback_ids.append(feedback["feedbackId"])
                    final_task = self._finish_task(str(task["taskId"]), "COMPLETED", {"goal": goal, "packId": pack["packId"]})
                    return {
                        "status": "COMPLETED",
                        "task": final_task,
                        "decisions": session.decision_count,
                        "feedbackIds": feedback_ids,
                    }

                if decision.status != "EXECUTE" or decision.body_step is None:
                    feedback = self._feedback(
                        pack,
                        decision,
                        delivered=None,
                        verified=None,
                        task_success=None,
                    )
                    feedback_ids.append(feedback["feedbackId"])
                    if decision.status == "WAIT" and decision.reason_code == "expected_effect_pending":
                        self.sleep(max(0.0, float(effect_wait_seconds)))
                        continue
                    final_task = self._finish_task(str(task["taskId"]), "CANCELLED", decision.reason_code)
                    return {
                        "status": decision.status,
                        "reason": decision.reason_code,
                        "task": final_task,
                        "decisions": session.decision_count,
                        "feedbackIds": feedback_ids,
                    }

                step_id = f"STEP-{decision.decision_id}"
                body_result = self.body.step(
                    task_id=str(task["taskId"]),
                    step_id=step_id,
                    step=decision.body_step,
                )
                execution = body_result.get("execution") or {}
                completed = execution.get("completed")
                dispatched = execution.get("dispatched")
                error = execution.get("error") or {}
                error_code = str(error.get("code") or "") or None

                # Re-observe after the one physical step. This is Brain evaluation,
                # never a hidden BODY retry.
                after = self.body.observe(task_id=str(task["taskId"]))
                after_pack = self.builder.build(
                    goal=goal,
                    observation=after,
                    task_policy=dict(task.get("policy") or {}),
                    records=records,
                )
                task_success = self.director.goal_achieved(after_pack)
                feedback = self._feedback(
                    pack,
                    decision,
                    delivered=dispatched if isinstance(dispatched, bool) else None,
                    verified=True if task_success else None,
                    task_success=True if task_success else None,
                    error_code=error_code,
                )
                feedback_ids.append(feedback["feedbackId"])

                if task_success:
                    final_task = self._finish_task(str(task["taskId"]), "COMPLETED", {"goal": goal, "packId": after_pack["packId"]})
                    return {
                        "status": "COMPLETED",
                        "task": final_task,
                        "decisions": session.decision_count,
                        "feedbackIds": feedback_ids,
                    }

                if completed is None:
                    # Durable unknown outcome is terminal for this run. Reissuing
                    # the semantic action could duplicate a physical action.
                    final_task = self._finish_task(
                        str(task["taskId"]), "FAILED", error_code or "body_step_outcome_unknown"
                    )
                    return {
                        "status": "WAIT",
                        "reason": error_code or "body_step_outcome_unknown",
                        "task": final_task,
                        "decisions": session.decision_count,
                        "feedbackIds": feedback_ids,
                    }
                if completed is not True:
                    final_task = self._finish_task(str(task["taskId"]), "FAILED", error_code or "body_step_incomplete")
                    return {
                        "status": "REPLAN",
                        "reason": error_code or "body_step_incomplete",
                        "task": final_task,
                        "decisions": session.decision_count,
                        "feedbackIds": feedback_ids,
                    }
                self.director.advance(session, decision, body_result)

            final_task = self._finish_task(str(task["taskId"]), "CANCELLED", "brain_decision_limit")
            return {
                "status": "WAIT",
                "reason": "brain_decision_limit",
                "task": final_task,
                "decisions": session.decision_count,
                "feedbackIds": feedback_ids,
            }
        except Exception as exc:
            try:
                self._finish_task(str(task["taskId"]), "FAILED", str(exc))
            except Exception:
                pass
            raise
