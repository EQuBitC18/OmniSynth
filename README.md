# OmniSynth — AI-Powered Research Intelligence Platform

> *Upload your papers. Run the pipeline. Get a knowledge graph, gap analysis, novel hypothesis, and structured briefs — automatically, in minutes.*

OmniSynth is a multi-agent AI system that compresses the most tedious parts of a literature review into a single automated pipeline. Upload PDFs, hit **Run Pipeline**, and six specialised agents do the rest.

---

## The Problem

A typical literature review looks like this:

1. Find and download relevant papers
2. Read them in full — 2 to 4 hours
3. Map key concepts and relationships
4. Identify gaps in the field
5. Formulate a hypothesis
6. Write a structured research brief

OmniSynth automates steps 2–6 in approximately **4–6 minutes**.

---

## Key Features

| Feature | Description |
|---|---|
| **6-Agent Pipeline** | Orchestrator, Ingestor, Synthesizer, Lint, Hypothesis, and Writer agents run in sequence — fully automated |
| **Live Knowledge Graph** | Interactive force-directed graph of concepts and relationships extracted across all papers |
| **Per-Paper Wikis** | Each uploaded paper is distilled into a structured markdown knowledge page |
| **Research Gap Detection** | The Lint Agent analyses the graph topology to find unexplored areas and missing connections |
| **Novel Hypothesis Generation** | Produces a testable scientific hypothesis — with rationale, expected impact, and testability criteria |
| **Research Brief** | A structured summary synthesising all findings, gaps, and the hypothesis into one document |
| **Session Management** | Named, persistent sessions scoped to a knowledge base — create, rename, revisit, and compare |
| **Chat Interface** | Ask follow-up questions answered exclusively from the current session's knowledge base |
| **File Management** | Open, edit, rename, or delete any generated file directly in the browser |
| **Tunable Pipeline** | 6 configurable parameters: model, temperature, wiki depth, gap count, hypothesis count, brief format |
| **Performance Metrics** | Aggregate statistics across all pipeline runs |
| **PDF Upload** | Upload papers directly into a session's RAW/ folder |


---

## How It Works

Upload PDFs, select a session, click **Run Pipeline**:

```
Uploaded PDFs in RAW/
        │
        ▼
┌─────────────────┐
│  Orchestrator   │  Validates inputs, coordinates all agents, signals completion
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Ingestor Agent  │  Converts each paper into a structured markdown wiki page
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│ Synthesizer Agent   │  Extracts concepts + relationships → builds the knowledge graph
└────────┬────────────┘
         │
         ▼
┌─────────────────┐
│   Lint Agent    │  Analyses graph topology, identifies research gaps
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│ Hypothesis Agent     │  Generates novel, testable hypotheses from the identified gaps
└────────┬─────────────┘
         │
         ▼
┌─────────────────┐
│  Writer Agent   │  Drafts the structured research brief
└────────┬────────┘
         │
         ▼
Session saved to SQLite — full results available
```

Every agent broadcasts its status over a WebSocket connection — you watch the pipeline run live in the sidebar.

---

## Tech Stack

### Backend
| Library | Role |
|---|---|
| **FastAPI** | REST API + WebSocket server |
| **Google Gemini 2.5** | LLM powering all six agents (Flash or Pro) |
| **google-genai SDK** | Gemini API client with structured output support |
| **pypdf** | PDF text extraction ||
| **SQLite** | Session persistence and metrics storage |
| **asyncio** | Async pipeline orchestration |
| **python-dotenv** | Environment variable management |

### Frontend
| Library | Role |
|---|---|
| **React 19** | Component-based UI |
| **Vite** | Dev server and bundler |
| **react-force-graph-2d** | Interactive knowledge graph rendering |
| **lucide-react** | Icon library |
| **WebSocket (native)** | Real-time agent log streaming |

---

## Project Structure

```
OmniSynth/
├── backend/
│   ├── main.py          # FastAPI app, all endpoints, WebSocket server
│   ├── agents.py        # OmniSynthAgents — the full 6-agent pipeline
│   ├── database.py      # SQLite helpers: init, save, update, query, metrics
│   ├── .env             # API keys (not committed)
│   └── requirements.txt
│
├── frontend/
│   └── src/
│       ├── App.jsx      # Main React component — all UI logic
│       ├── App.css      # Custom CSS (glassmorphism design system)
│       ├── index.css    # CSS variables and global resets
│       └── main.jsx     # React entry point
│
├── .gitignore
└── README.md
```

Generated at runtime (not committed):
```
backend/
├── raw/             # Uploaded papers (.pdf / .txt)
├── wikis/           # AI-generated wiki pages per paper (.md)
├── briefs/          # Research briefs (.md)
├── hypotheses/      # Generated hypotheses (.md)
├── gaps/            # Research gap analyses (.md)
├── graph.json       # Latest knowledge graph
└── omnisynth.db     # Session history database
```

---

## Setup & Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- A **Gemini API key** — free tier at [aistudio.google.com](https://aistudio.google.com/apikey)

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd OmniSynth
```

### 2. Set up the backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
echo GEMINI_API_KEY=your_key_here > .env
```

### 3. Set up the frontend
```bash
cd ../frontend
npm install
```

### 4. Start both servers

**Terminal 1 — Backend:**
```bash
cd backend
python main.py
# Runs at http://localhost:8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Opens at http://localhost:5173
```

---

## Usage Guide

### Basic workflow

1. **Create a session** — click **+** in the History panel (bottom-right sidebar).
2. **Upload papers** — in the RAW/ section, click **+** to upload a PDF.
3. **Run the pipeline** — click **Run Pipeline** in the left sidebar. Watch the six agents execute in sequence.
4. **Explore results** — knowledge graph, wikis, brief, gaps, and hypothesis all appear in the sidebar.

### Sessions

- **Select a session** by clicking it in the History panel — all operations are scoped to it.
- **Deselect** by clicking the active session again.
- **Rename** — hover over a session and click the pencil icon, then press Enter to confirm.
- Every session is persisted in SQLite and fully restorable.

### Knowledge Graph

| Colour | Node Type | Meaning |
|---|---|---|
| Purple | Core Topic | Central concepts in the domain |
| Green | Method | Techniques, approaches, and algorithms |
| Red | Finding | Experimental results and conclusions |

- **Click a node** for an AI-generated description and its connections
- **Click ⓘ** (top-right of graph) for a guide to reading the graph
- **Drag** to pan, **scroll** to zoom

### Chat

Click the chat bubble (bottom-right of the graph pane) to open the knowledge base chat. Answers are grounded exclusively in the current session's compiled knowledge.

### Files

Click any file in the Knowledge Base sidebar to open it. Use **Edit** to modify and **Save** to persist. Hover over a file to rename or delete it.

---

## Pipeline Settings

Click the **sliders icon** in the query bar to configure before running:

| Setting | Options | Effect |
|---|---|---|
| **Temperature** | 0.0–1.0 | Low = precise; high = exploratory |
| **Model** | Flash / Pro | Flash is faster; Pro produces more nuanced output |
| **Research gaps** | 1–5 | Number of gap sections to identify |
| **Hypotheses** | 1–3 | Number of hypotheses to generate |
| **Wiki detail** | Brief / Standard / Detailed | Depth of each wiki page |
| **Brief format** | Knowledge Summary / Executive / Bullet Points | Output structure of the final brief |

---

## Performance Metrics

Click the **bar chart icon** in the query bar to view aggregate stats across all runs:

| Metric | How it's calculated |
|---|---|
| **Total Runs** | `COUNT(*) FROM sessions` |
| **Success Rate** | `sessions_with_metrics / total × 100` |
| **Avg. Pipeline Time** | Mean wall-clock time from query submission to finished brief |
| **Papers Processed** | `SUM(papers_processed)` across successful runs |
| **Avg. Graph Nodes** | Mean concepts extracted per knowledge graph |
| **Time Saved / Run** | `60 min baseline − avg_pipeline_time` |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/query` | Start a pipeline run |
| `POST` | `/api/upload/raw` | Upload a paper into RAW/ |
| `GET` | `/api/files` | List all files across knowledge base folders |
| `GET` | `/api/graph` | Return the latest knowledge graph JSON |
| `GET` | `/api/brief/{filename}` | Get brief content |
| `GET` | `/api/wiki/{filename}` | Get wiki content |
| `GET` | `/api/raw/{filename}` | Get raw file content |
| `GET` | `/api/hypothesis/{filename}` | Get hypothesis content |
| `GET` | `/api/gaps/{filename}` | Get gaps content |
| `PUT` | `/api/file/{folder}/{filename}` | Save / overwrite a file |
| `DELETE` | `/api/file/{folder}/{filename}` | Delete a file |
| `POST` | `/api/file/{folder}/{filename}/rename` | Rename a file within its folder |
| `POST` | `/api/chat` | Chat with the knowledge base |
| `POST` | `/api/node-description` | Get AI description for a graph node |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/{id}` | Get full session data |
| `POST` | `/api/sessions/new` | Create a blank session |
| `PATCH` | `/api/sessions/{id}` | Rename a session |
| `DELETE` | `/api/sessions/{id}` | Delete a session |
| `GET` | `/api/metrics` | Get aggregate performance metrics |
| `WS` | `/ws/logs` | Real-time agent log stream |

---

## Why OmniSynth Stands Out

Most AI research tools are glorified search engines or single-prompt summarisers. OmniSynth is different:

1. **It reasons across papers, not just within one.** The Synthesizer builds a graph connecting concepts from multiple sources, surfacing relationships no individual paper shows.
2. **It identifies what is missing, not just what exists.** The Lint Agent analyses graph topology to find the blind spots in a field.
3. **It produces actionable output.** The hypothesis includes a statement, rationale, expected impact, and testability criteria — not a vague suggestion.
4. **It is fully transparent.** Every agent logs what it is doing in real time. You are never waiting on a black box.
5. **Everything is persistent.** Sessions are stored in SQLite — revisit, compare, and continue any prior run.

---

## Potential Extensions

- **Cross-session graph merging** — combine knowledge graphs from multiple sessions into one super-graph
- **Citation export** — generate BibTeX references for all processed papers
- **Collaborative sessions** — share a session with a colleague via link
- **Hypothesis validation agent** — automatically search for prior work that supports or refutes the generated hypothesis

---

## License

MIT — free to use, modify, and build upon.

---

*Built with FastAPI, React, and Google Gemini. Milan AI Week Hackathon — May 2026.*
