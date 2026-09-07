from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from brain.data_factory import DataFactory, EvidenceInputError, evidence_record_hash
from brain.store import BrainStore


def valid_evidence():
    row = {
        "schemaVersion": 1,
        "evidenceId": "EV-HASH-1",
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
        "beforeState": {"available": True, "platform": "youtube", "route": {"pageType": "home"}},
        "action": {"type": "youtube.search", "trigger": "keyboard_enter", "queryCaptured": False},
        "afterState": {"available": True, "platform": "youtube", "route": {"pageType": "search"}},
        "observedEffect": {"searchResultsObserved": True, "navigationObserved": True},
        "previousHash": None,
    }
    row["recordHash"] = evidence_record_hash(row)
    return row


class BrainEvidenceIntegrityContractTest(unittest.TestCase):
    def test_verified_evidence_is_compiled(self):
        with tempfile.TemporaryDirectory() as tmp:
            with BrainStore(Path(tmp) / "brain.db") as store:
                result = DataFactory(store).ingest_rows([valid_evidence()])
                self.assertEqual(result["stored"], 1)
                self.assertEqual(store.counts()["brainReadyRecords"], 1)

    def test_modified_evidence_with_original_hash_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            with BrainStore(Path(tmp) / "brain.db") as store:
                row = valid_evidence()
                tampered = copy.deepcopy(row)
                tampered["observedEffect"]["searchResultsObserved"] = False
                with self.assertRaisesRegex(EvidenceInputError, "evidence_integrity_violation"):
                    DataFactory(store).ingest_rows([tampered])
                self.assertEqual(store.counts()["brainReadyRecords"], 0)

    def test_broken_chain_link_fails_before_compilation(self):
        with tempfile.TemporaryDirectory() as tmp:
            with BrainStore(Path(tmp) / "brain.db") as store:
                first = valid_evidence()
                second = valid_evidence()
                second["evidenceId"] = "EV-HASH-2"
                second["previousHash"] = "wrong-previous"
                second["recordHash"] = evidence_record_hash(second)
                with self.assertRaisesRegex(EvidenceInputError, "evidence_chain_link_broken"):
                    DataFactory(store).ingest_rows([first, second])


if __name__ == "__main__":
    unittest.main()
