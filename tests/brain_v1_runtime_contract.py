from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from brain.context_builder import ContextBuilder, load_registry
from brain.contracts import BrainContractError, validate_brain_ready_record
from brain.data_factory import DataFactory, compile_youtube_search
from brain.director import BrainSession, Director
from brain.runtime import GoalRunner
from brain.store import BrainStore, BrainStoreConflict


def evidence(evidence_id: str = "EV-1"):
    return {
        "schemaVersion": 1,
        "evidenceId": evidence_id,
        "recordedAt": "2026-09-07T10:00:00Z",
        "identity": {
            "companyId": "COMPANY-A",
            "deviceId": "DEVICE-A",
            "browserInstanceId": "browser-a",
            "extensionInstanceId": "extension-a",
            "runtimeExtensionId": "runtime-a",
        },
        "siteKey": "youtube.com",
        "tabId": 7,
        "source": "human",
        "provenance": {"kind": "human_demonstration", "trustedInput": True},
        "beforeState": {
            "available": True,
            "platform": "youtube",
            "route": {"pageType": "home"},
        },
        "action": {"type": "youtube.search", "trigger": "keyboard_enter", "queryCaptured": False},
        "afterState": {
            "available": True,
            "platform": "youtube",
            "route": {"pageType": "search"},
        },
        "observedEffect": {"searchResultsObserved": True, "navigationObserved": True},
        "previousHash": None,
        "recordHash": "hash-1",
    }


def observation(*, page_type: str = "home", results: bool = False, eligible: bool = True):
    return {
        "contractVersion": "1.0",
        "observedAt": 1000,
        "scope": {
            "browserInstanceId": "browser-a",
            "extensionInstanceId": "extension-a",
            "tabId": 7,
            "siteKey": "youtube.com",
        },
        "bodyState": {"pointer": {"known": True, "x": 20, "y": 30}, "browserState": "ACTIVE", "activeTabId": 7},
        "control": {"activeTarget": None, "lastObservedTarget": None, "semanticControls": None},
        "content": {
            "tabContext": {"siteKey": "youtube.com"},
            "page": {},
            "semantic": {
                "available": True,
                "platform": "youtube",
                "route": {"pageType": page_type},
                "controls": {
                    "searchInput": {
                        "available": True,
                        "visible": True,
                        "active": True,
                        "actionRect": {"x": 100, "y": 40, "width": 400, "height": 36},
                    }
                },
                "surfaces": ([{"surface": "search_results", "itemCount": 10}] if results else []),
            },
        },
        "environment": {"online": True, "browserState": "ACTIVE", "eligible": eligible, "status": "ELIGIBLE" if eligible else "INELIGIBLE", "reasons": []},
        "freshness": {"liveRefreshAttempted": True, "liveRefreshSucceeded": True, "tabContextAgeMs": 0, "pageAgeMs": 0, "semanticAgeMs": 0, "controlAgeMs": 0},
    }


class FakeBody:
    def __init__(self, *, unknown: bool = False, succeed_after_steps: int | None = None):
        self.unknown = unknown
        self.succeed_after_steps = succeed_after_steps
        self.step_calls = 0
        self.requests = []

    def readiness(self):
        return {"state": "READY", "browsers": [{"browserInstanceId": "browser-a", "state": "READY"}]}

    def observe(self, **_kwargs):
        success = self.succeed_after_steps is not None and self.step_calls >= self.succeed_after_steps
        return observation(page_type="search" if success else "home", results=success)

    def task_create(self, _task):
        return {
            "taskId": "TASK-1",
            "state": "READY",
            "policy": {"policyClass": "SAFE_AUTO", "eligible": True, "requiresApproval": False, "reason": "safe_capability"},
        }

    def task_start(self, _task_id):
        return {
            "taskId": "TASK-1",
            "state": "RUNNING",
            "policy": {"policyClass": "SAFE_AUTO", "eligible": True, "requiresApproval": False, "reason": "safe_capability"},
        }

    def step(self, *, task_id, step_id, step):
        self.step_calls += 1
        self.requests.append((task_id, step_id, copy.deepcopy(step)))
        if self.unknown:
            return {"execution": {"completed": None, "dispatched": None, "error": {"code": "body_step_outcome_unknown"}}}
        return {"execution": {"completed": True, "dispatched": True, "error": None}}

    def request(self, message_type, **payload):
        self.requests.append((message_type, copy.deepcopy(payload)))
        state = {"TASK_COMPLETE": "COMPLETED", "TASK_FAIL": "FAILED", "TASK_CANCEL": "CANCELLED"}[message_type]
        return {"result": {"taskId": "TASK-1", "state": state}}


class BrainV1RuntimeContractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = BrainStore(self.root / "brain.db")
        self.record = compile_youtube_search(evidence())
        self.store.put_record(self.record)
        self.builder = ContextBuilder(load_registry(ROOT / "config" / "brain-capabilities-v1.json"), now=lambda: "2026-09-07T10:00:01Z")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def pack(self, *, obs=None, records=None, policy=None):
        return self.builder.build(
            goal={"type": "youtube.search", "parameters": {"query": "robotics"}},
            observation=obs or observation(),
            task_policy=policy or {"policyClass": "SAFE_AUTO", "eligible": True, "reason": "safe_capability"},
            records=self.store.list_records() if records is None else records,
        )

    def test_data_factory_produces_traceable_human_record_without_authority(self):
        record = self.record
        self.assertEqual(record["provenance"]["source"], "human")
        self.assertEqual(record["provenance"]["rawEvidenceRefs"], ["EV-1"])
        serialized = repr(record).lower()
        self.assertNotIn("autonomy", serialized)
        self.assertNotIn("executionpermission", serialized)
        self.assertEqual(record["quality"]["humanSampleCount"], 1)
        self.assertEqual(record["quality"]["agentSampleCount"], 0)

    def test_agent_input_cannot_become_human_ground_truth(self):
        agent = evidence("EV-A")
        agent["source"] = "agent"
        factory = DataFactory(self.store)
        self.assertIsNone(factory.compile(agent))
        invalid = copy.deepcopy(self.record)
        invalid["recordId"] = "BRR-agent-invalid"
        invalid["provenance"]["source"] = "agent"
        with self.assertRaises(BrainContractError):
            validate_brain_ready_record(invalid)

    def test_brain_ready_store_is_immutable(self):
        replay = self.store.put_record(copy.deepcopy(self.record))
        self.assertTrue(replay["replayed"])
        changed = copy.deepcopy(self.record)
        changed["semantic"]["effect"]["pageType"] = "watch"
        with self.assertRaises(BrainStoreConflict):
            self.store.put_record(changed)

    def test_context_builder_contains_semantic_context_not_raw_event_timeline(self):
        pack = self.pack()
        self.assertEqual(pack["capabilities"][0]["name"], "youtube.search")
        self.assertEqual(pack["capabilities"][0]["autonomy"], 2)
        self.assertEqual(pack["sourceRecordIds"], [self.record["recordId"]])
        serialized = repr(pack).lower()
        for forbidden in ["mousemove", "keydown", "rawhuman", "recordhash", "previoushash"]:
            self.assertNotIn(forbidden, serialized)

    def test_director_emits_exactly_one_body_step_per_execute_decision(self):
        director = Director(id_factory=iter(["DEC-1", "DEC-2"]).__next__)
        session = BrainSession()
        first = director.decide(self.pack(), session)
        self.assertEqual(first.status, "EXECUTE")
        self.assertEqual(first.body_step["intent"]["type"], "typeText")
        self.assertNotIn("actions", first.body_step["intent"])
        director.advance(session, first, {"execution": {"completed": True}})
        second = director.decide(self.pack(), session)
        self.assertEqual(second.status, "EXECUTE")
        self.assertEqual(second.body_step, {"kind": "motor", "intent": {"type": "pressKey", "key": "Enter"}})

    def test_policy_and_environment_block_before_execution(self):
        director = Director(id_factory=lambda: "DEC-BLOCK")
        restricted = self.pack(policy={"policyClass": "RESTRICTED", "eligible": False})
        self.assertEqual(director.decide(restricted, BrainSession()).status, "REJECT")
        blocked_env = self.pack(obs=observation(eligible=False))
        decision = director.decide(blocked_env, BrainSession())
        self.assertEqual(decision.status, "WAIT")
        self.assertIsNone(decision.body_step)

    def test_missing_human_capability_evidence_requests_evidence(self):
        director = Director(id_factory=lambda: "DEC-NO-EVIDENCE")
        decision = director.decide(self.pack(records=[]), BrainSession())
        self.assertEqual(decision.status, "REQUEST_EVIDENCE")
        self.assertIsNone(decision.body_step)

    def test_unknown_body_outcome_never_reissues_step(self):
        body = FakeBody(unknown=True)
        runner = GoalRunner(body, self.store, evidence_root=self.root / "no-evidence", context_builder=self.builder, director=Director(id_factory=lambda: "DEC-UNKNOWN"), sleep=lambda _: None)
        result = runner.run_youtube_search("robotics", max_decisions=4)
        self.assertEqual(result["status"], "WAIT")
        self.assertEqual(result["reason"], "body_step_outcome_unknown")
        self.assertEqual(body.step_calls, 1)
        self.assertEqual(len(self.store.list_feedback()), 1)

    def test_bounded_goal_runner_completes_after_two_distinct_body_steps(self):
        ids = iter(["DEC-TYPE", "DEC-ENTER"])
        body = FakeBody(succeed_after_steps=2)
        runner = GoalRunner(body, self.store, evidence_root=self.root / "no-evidence", context_builder=self.builder, director=Director(id_factory=ids.__next__), sleep=lambda _: None)
        result = runner.run_youtube_search("robotics", max_decisions=4)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(body.step_calls, 2)
        step_ids = [row[1] for row in body.requests if isinstance(row, tuple) and len(row) == 3 and str(row[1]).startswith("STEP-")]
        self.assertEqual(step_ids, ["STEP-DEC-TYPE", "STEP-DEC-ENTER"])
        self.assertEqual(len(set(step_ids)), 2)
        self.assertEqual(len(self.store.list_feedback()), 2)


if __name__ == "__main__":
    unittest.main()
