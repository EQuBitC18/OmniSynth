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
                agent_logs  TEXT
            )
        """)


def save_session(*, query, graph_data, brief, hypothesis, gaps, raw_files, wiki_files, agent_logs):
    with _conn() as conn:
        conn.execute("""
            INSERT INTO sessions
                (query, graph_data, brief, hypothesis, gaps, raw_files, wiki_files, agent_logs)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            query,
            json.dumps(graph_data),
            brief,
            hypothesis,
            gaps,
            json.dumps(raw_files),
            json.dumps(wiki_files),
            json.dumps(agent_logs),
        ))


def list_sessions():
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, query, created_at FROM sessions ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_session(session_id: int):
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None
        data = dict(row)
        for field in ("graph_data", "raw_files", "wiki_files", "agent_logs"):
            if data[field]:
                data[field] = json.loads(data[field])
        return data
