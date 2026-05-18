import sqlite3
import json

DB_PATH = "omnisynth.db"


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                query       TEXT    NOT NULL,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                graph_data  TEXT,
                brief       TEXT,
                hypothesis  TEXT,
                gaps        TEXT,
                raw_files   TEXT,
                wiki_files  TEXT,
                agent_logs  TEXT,
                metrics     TEXT
            )
        """)
        # Migrations for existing DBs
        for col in ("metrics TEXT", "brief_files TEXT"):
            try:
                conn.execute(f"ALTER TABLE sessions ADD COLUMN {col}")
            except Exception:
                pass


def save_session(*, query, graph_data, brief, hypothesis, gaps, raw_files, wiki_files,
                 agent_logs, metrics=None, brief_files=None):
    with _conn() as conn:
        conn.execute("""
            INSERT INTO sessions
                (query, graph_data, brief, hypothesis, gaps, raw_files, wiki_files,
                 agent_logs, metrics, brief_files)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            query,
            json.dumps(graph_data),
            brief,
            hypothesis,
            gaps,
            json.dumps(raw_files),
            json.dumps(wiki_files),
            json.dumps(agent_logs),
            json.dumps(metrics) if metrics else None,
            json.dumps(brief_files) if brief_files else None,
        ))


def list_sessions():
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, query, created_at FROM sessions ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_aggregate_metrics():
    with _conn() as conn:
        total_runs = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        if total_runs == 0:
            return {"total_runs": 0, "successful_runs": 0, "avg_time_seconds": 0,
                    "total_papers": 0, "avg_graph_nodes": 0, "steps_automated": 7}

        rows = conn.execute("SELECT metrics FROM sessions WHERE metrics IS NOT NULL").fetchall()
        data = []
        for r in rows:
            try:
                data.append(json.loads(r[0]))
            except Exception:
                pass

        successful = len(data)
        avg_time   = round(sum(d.get("total_time_seconds", 0) for d in data) / successful, 1) if successful else 0
        total_pap  = sum(d.get("papers_processed", 0) for d in data)
        avg_nodes  = round(sum(d.get("graph_nodes", 0) for d in data) / successful, 1) if successful else 0
        avg_steps  = round(sum(d.get("steps_completed", 0) for d in data) / successful, 1) if successful else 0

        return {
            "total_runs":       total_runs,
            "successful_runs":  successful,
            "success_rate":     round(successful / total_runs * 100) if total_runs else 0,
            "avg_time_seconds": avg_time,
            "total_papers":     total_pap,
            "avg_graph_nodes":  avg_nodes,
            "avg_steps":        avg_steps,
            "steps_automated":  7,
        }


def update_session(session_id: int, *, query, graph_data, brief, hypothesis, gaps,
                   raw_files, wiki_files, agent_logs, metrics=None, brief_files=None):
    with _conn() as conn:
        conn.execute("""
            UPDATE sessions SET
                query=?, graph_data=?, brief=?, hypothesis=?, gaps=?,
                raw_files=?, wiki_files=?, agent_logs=?, metrics=?, brief_files=?
            WHERE id=?
        """, (
            query,
            json.dumps(graph_data),
            brief, hypothesis, gaps,
            json.dumps(raw_files),
            json.dumps(wiki_files),
            json.dumps(agent_logs),
            json.dumps(metrics) if metrics else None,
            json.dumps(brief_files) if brief_files else None,
            session_id,
        ))


def create_blank_session(name: str = "New Session") -> int:
    with _conn() as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (query, raw_files, wiki_files, agent_logs) VALUES (?, '[]', '[]', '[]')",
            (name,)
        )
        return cursor.lastrowid


def delete_session(session_id: int):
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))


def get_session(session_id: int):
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None
        data = dict(row)
        for field in ("graph_data", "raw_files", "wiki_files", "agent_logs", "brief_files"):
            if data.get(field):
                data[field] = json.loads(data[field])
        return data
