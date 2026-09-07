from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from .contracts import validate_brain_ready_record, validate_feedback_record


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def payload_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


class BrainStoreConflict(RuntimeError):
    pass


class BrainStore:
    """Immutable semantic record store plus append-only Agent feedback store."""

    def __init__(self, pathname: Path | str):
        self.pathname = Path(pathname)
        self.pathname.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.pathname))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS brain_ready_records (
              record_id TEXT PRIMARY KEY,
              payload_hash TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              capability TEXT,
              platform TEXT,
              source TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_brr_capability ON brain_ready_records(capability);
            CREATE INDEX IF NOT EXISTS idx_brr_platform ON brain_ready_records(platform);
            CREATE TABLE IF NOT EXISTS brain_feedback_records (
              feedback_id TEXT PRIMARY KEY,
              payload_hash TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              decision_id TEXT NOT NULL,
              pack_id TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bfr_pack ON brain_feedback_records(pack_id);
            """
        )
        self.db.commit()

    def put_record(self, record: dict[str, Any]) -> dict[str, Any]:
        validate_brain_ready_record(record)
        record_id = str(record["recordId"])
        encoded = canonical_json(record)
        digest = payload_hash(record)
        current = self.db.execute(
            "SELECT payload_hash FROM brain_ready_records WHERE record_id=?", (record_id,)
        ).fetchone()
        if current:
            if current["payload_hash"] != digest:
                raise BrainStoreConflict(f"brain_ready_record_immutable_conflict:{record_id}")
            return {"recordId": record_id, "stored": False, "replayed": True}
        semantic = record.get("semantic") or {}
        capability = (semantic.get("capabilityCandidate") or {}).get("name")
        scope = record.get("scope") or {}
        with self.db:
            self.db.execute(
                "INSERT INTO brain_ready_records(record_id,payload_hash,payload_json,capability,platform,source,created_at) VALUES(?,?,?,?,?,?,?)",
                (
                    record_id,
                    digest,
                    encoded,
                    capability,
                    scope.get("platform"),
                    (record.get("provenance") or {}).get("source"),
                    record["createdAt"],
                ),
            )
        return {"recordId": record_id, "stored": True, "replayed": False}

    def get_record(self, record_id: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT payload_json FROM brain_ready_records WHERE record_id=?", (str(record_id),)
        ).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def list_records(self, *, capability: str | None = None, platform: str | None = None) -> list[dict[str, Any]]:
        clauses: list[str] = []
        args: list[Any] = []
        if capability is not None:
            clauses.append("capability=?")
            args.append(str(capability))
        if platform is not None:
            clauses.append("platform=?")
            args.append(str(platform))
        sql = "SELECT payload_json FROM brain_ready_records"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at, record_id"
        return [json.loads(row["payload_json"]) for row in self.db.execute(sql, args).fetchall()]

    def put_feedback(self, record: dict[str, Any]) -> dict[str, Any]:
        validate_feedback_record(record)
        feedback_id = str(record["feedbackId"])
        digest = payload_hash(record)
        encoded = canonical_json(record)
        current = self.db.execute(
            "SELECT payload_hash FROM brain_feedback_records WHERE feedback_id=?", (feedback_id,)
        ).fetchone()
        if current:
            if current["payload_hash"] != digest:
                raise BrainStoreConflict(f"brain_feedback_record_immutable_conflict:{feedback_id}")
            return {"feedbackId": feedback_id, "stored": False, "replayed": True}
        with self.db:
            self.db.execute(
                "INSERT INTO brain_feedback_records(feedback_id,payload_hash,payload_json,decision_id,pack_id,created_at) VALUES(?,?,?,?,?,?)",
                (
                    feedback_id,
                    digest,
                    encoded,
                    record["decisionId"],
                    record["packId"],
                    record["createdAt"],
                ),
            )
        return {"feedbackId": feedback_id, "stored": True, "replayed": False}

    def list_feedback(self, *, pack_id: str | None = None) -> list[dict[str, Any]]:
        if pack_id is None:
            rows = self.db.execute("SELECT payload_json FROM brain_feedback_records ORDER BY created_at, feedback_id").fetchall()
        else:
            rows = self.db.execute(
                "SELECT payload_json FROM brain_feedback_records WHERE pack_id=? ORDER BY created_at, feedback_id",
                (str(pack_id),),
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def counts(self) -> dict[str, int]:
        records = int(self.db.execute("SELECT COUNT(*) FROM brain_ready_records").fetchone()[0])
        feedback = int(self.db.execute("SELECT COUNT(*) FROM brain_feedback_records").fetchone()[0])
        return {"brainReadyRecords": records, "brainFeedbackRecords": feedback}

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "BrainStore":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
