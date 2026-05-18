# OmniSynth — AI-Powered Research Intelligence Platform

> *Upload your papers. Run the pipeline. Get a knowledge graph, gap analysis, novel hypothesis, and per-paper summaries — automatically.*

OmniSynth is a multi-agent AI system built for researchers, students, and curious minds who want to understand a body of literature quickly and deeply. Upload one or more PDF papers, hit **Run Pipeline**, and six specialised AI agents do the rest.

---

## What Problem Does It Solve?

A typical literature review looks like this:

1. Find and download relevant papers
2. Read them in full (2–4 hours)
3. Take notes, identify key concepts and relationships
4. Spot gaps in the literature
5. Formulate a research hypothesis
6. Write a structured research brief

OmniSynth compresses steps 2–6 into a single automated pipeline that runs in approximately **4–6 minutes** — giving you more time for the parts of research that actually require human insight.

---

## Key Features

| Feature | Description |
|---|---|
| **PDF Upload** | Upload your own papers directly into a session's knowledge base |
| **arXiv Search** | Alternatively search and pull full papers from arXiv automatically |
| **6-Agent Pipeline** | Orchestrator, Ingestor, Synthesizer, Lint, Hypothesis, Writer agents in sequence |
| **Per-Paper Summaries** | The Writer Agent generates a dedicated brief for every uploaded paper |
| **Live Knowledge Graph** | Interactive node-link graph of concepts extracted from the literature |
| **Research Gap Detection** | AI identifies unexplored areas and missing connections in the field |
| **Novel Hypothesis Generation** | Produces structured, testable scientific hypotheses from the gaps |
| **Named Sessions** | Explicitly create sessions (Session_1, Session_2, …) — all operations are scoped to the selected session |
| **Session History** | Every run is saved to SQLite — browse, revisit, and compare past sessions |
| **Chat Interface** | Ask follow-up questions answered from the current session's knowledge base |
| **Tunable Parameters** | 7 pipeline settings (temperature, model, wiki depth, gap count, etc.) |
| **Performance Metrics** | Aggregate statistics across all pipeline runs |
| **File Editor** | Edit any generated file directly in the browser |

---

## How It Works — The Pipeline

Select a session, upload one or more PDFs (or search arXiv), then click **Run Pipeline**:

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
│   Lint Agent    │  Analyses the graph topology, identifies research gaps
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│ Hypothesis Agent     │  Generates novel, testable scientific hypotheses from the gaps
└────────┬─────────────┘
         │
         ▼
┌─────────────────┐
│  Writer Agent   │  Writes a structured summary brief for each uploaded paper
└────────┬────────┘
         │
         ▼
Session saved to SQLite — page reloads with full results
```

Each agent broadcasts its status in real time over a WebSocket connection, so you watch the pipeline progress live in the sidebar.

---

## Tech Stack

### Backend
| Library | Role |
|---|---|
| **FastAPI** | REST API + WebSocket server |
| **Google Gemini 2.5** | LLM powering all AI agents (Flash or Pro) |
| **google-genai SDK** | Gemini API client with structured output support |
| **arxiv** | arXiv API client for paper search and download |
| **pypdf** | PDF text extraction |
| **SQLite (built-in)** | Session persistence and metrics storage |
| **asyncio** | Async pipeline orchestration |
| **python-dotenv** | Environment variable management |

### Frontend
| Library | Role |
|---|---|
| **React 18** | Component-based UI |
| **Vite** | Dev server and bundler |
| **react-force-graph-2d** | Interactive knowledge graph rendering |
| **lucide-react** | Icon library |
| **WebSocket (native)** | Real-time agent log streaming |

---

## Project Structure

```
OmniSynth/
├── backend/
│   ├── main.py          # FastAPI app, all API endpoints, WebSocket server
│   ├── agents.py        # OmniSynthAgents class — the full 6-agent pipeline
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
├── wikis/           # AI-generated wiki pages (.md)
├── briefs/          # Per-paper summaries (.md)
├── hypotheses/      # Generated hypothesis (.md)
├── gaps/            # Research gap analysis (.md)
├── graph.json       # Latest knowledge graph data
└── omnisynth.db     # Session history database
```

---

## Setup & Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- A **Gemini API key** (free tier available at [aistudio.google.com](https://aistudio.google.com/apikey))

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd OmniSynth
```

### 2. Set up the backend
```bash
cd backend

# Create and activate a virtual environment (recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Add your Gemini API key
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
# Server starts at http://localhost:8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# App opens at http://localhost:5173
```

Open your browser to `http://localhost:5173` and you're ready to go.

---

## Usage Guide

### Basic workflow

1. **Create a session** — click **+** in the History panel (bottom-right sidebar). A new session named `Session_N` is created and selected (highlighted in amber).
2. **Upload papers** — in the RAW/ section of the Knowledge Base, click **+** to upload a PDF, or click the search icon to pull papers from arXiv.
3. **Run the pipeline** — click **Run Pipeline** (top of the left sidebar). The six agents execute automatically.
4. **Explore results** — when complete the page reloads showing the knowledge graph, per-paper briefs, wikis, gaps, and hypothesis in the Knowledge Base sidebar.

### Sessions

- **Click a session** in the History panel to select it — all operations (upload, pipeline run) apply to that session.
- **Click the selected session again** to deselect it.
- **Session names** are assigned automatically (`Session_1`, `Session_2`, …) and preserved across pipeline runs.
- Sessions are stored in SQLite. Selecting a session reloads its graph, files, and generated documents.

### Reading the Knowledge Graph

The graph shows concepts extracted from the literature as nodes, connected by semantic relationships.

| Colour | Type | Meaning |
|---|---|---|
| Purple | Core Topic | Central concepts in the domain |
| Green | Method | Techniques, approaches, and algorithms |
| Red | Finding | Experimental results and conclusions |

- **Click a node** to see its AI-generated description and connections
- **Click a connected node** in the panel to hop to it
- **Click ⓘ** (top-right of graph) for an explanation of the graph structure
- **Drag** to pan, **scroll** to zoom

### Chat with the Knowledge Base

Click the blue chat bubble (bottom-right of the graph) to open the chat interface. Ask anything about the compiled research — answers draw only from the current session's knowledge base.

### Editing files

Click any file in the Knowledge Base sidebar to open it. Use the **Edit** button in the header to modify content and **Save** to persist changes to disk.

---

## Pipeline Settings

Click the **sliders icon** (top-right of the main area) to configure the pipeline before running:

| Setting | Options | Effect |
|---|---|---|
| **Papers to fetch** | 1–10 | Number of papers to pull when using arXiv Search |
| **Temperature** | 0.0–1.0 | Low = precise/factual; High = creative/exploratory |
| **Sort order** | Relevance / Most Recent | arXiv ranking for search results |
| **Model** | Flash / Pro | Flash is faster; Pro produces more nuanced output |
| **Research gaps** | 1–5 | Number of gap sections to identify |
| **Hypotheses** | 1–3 | Number of hypotheses to generate |
| **Wiki detail** | Brief / Standard / Detailed | Depth of each wiki page |

---

## Performance Metrics

Click the **bar chart icon** (top-right of the main area) to open the metrics panel. How each number is calculated:

| Metric | Formula |
|---|---|
| **Total Runs** | `COUNT(*) FROM sessions` |
| **Success Rate** | `sessions_with_metrics / total × 100` |
| **Avg. Pipeline Time** | `SUM(total_time_seconds) / successful_runs` |
| **Papers Processed** | `SUM(papers_processed)` across all successful runs |
| **Avg. Graph Nodes** | `SUM(graph_nodes) / successful_runs` |
| **Steps Automated** | Fixed at 7 (one per agent + orchestrator) |
| **Time Saved / Run** | `60 min baseline − avg_pipeline_time` |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/query` | Start a pipeline run |
| `POST` | `/api/upload/raw` | Upload a paper into RAW/ |
| `POST` | `/api/arxiv-search` | Search arXiv and download papers |
| `GET` | `/api/files` | List all files in raw/, wikis/, briefs/, hypotheses/, gaps/ |
| `GET` | `/api/graph` | Return the latest knowledge graph JSON |
| `GET` | `/api/brief/{filename}` | Get brief content |
| `GET` | `/api/wiki/{filename}` | Get wiki content |
| `GET` | `/api/raw/{filename}` | Get raw file content (PDF served as binary) |
| `GET` | `/api/hypothesis/{filename}` | Get hypothesis content |
| `GET` | `/api/gaps/{filename}` | Get gaps content |
| `PUT` | `/api/file/{folder}/{filename}` | Save / overwrite a file |
| `DELETE` | `/api/file/{folder}/{filename}` | Delete a file |
| `POST` | `/api/chat` | Chat with the knowledge base |
| `POST` | `/api/node-description` | Get AI description for a graph node |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/{id}` | Get full session data |
| `POST` | `/api/sessions/new` | Create a blank named session |
| `DELETE` | `/api/sessions/{id}` | Delete a session |
| `GET` | `/api/metrics` | Get aggregate performance metrics |
| `WS` | `/ws/logs` | Real-time agent log stream |

---

## Edge Cases Handled

| Situation | Behaviour |
|---|---|
| No papers in RAW/ when pipeline runs | Orchestrator reports error and aborts cleanly |
| PDF upload | Saved as binary; converted to `.txt` by the pipeline before processing |
| arXiv HTTP 429 (rate limit) | Waits 30 s, retries, waits 60 s, retries again before giving up |
| Gemini API 429 (rate limit) | Retries after 20 s, then 45 s, then raises to the orchestrator |
| Invalid / missing API key | `self.client` is None — returns mock output with a clear message |
| LLM returns malformed JSON (graph) | Caught by try/except, falls back to `{"nodes": [], "links": []}` |
| Pipeline crash anywhere | Top-level try/except broadcasts error to frontend, unlocks the UI |
| Blank session (no saved files) | Pipeline uses current filesystem RAW/ contents — uploads survive |
| Session selected across page reload | Active session ID persisted in `localStorage`, restored on mount |

---

## Why OmniSynth Stands Out

Most AI research tools are either glorified search engines or single-prompt summarisers. OmniSynth is different because:

1. **It reasons across papers, not just within one.** The Synthesizer builds a graph connecting concepts from multiple sources, revealing relationships no single paper shows.
2. **It identifies what is missing, not just what exists.** The Lint Agent specifically looks for gaps — the blind spots in a field.
3. **It produces actionable output.** The hypothesis is formatted with a statement, rationale, expected impact, and testability criteria.
4. **Everything is persistent and revisitable.** Sessions are stored in SQLite so you can return to any prior run and continue from where you left off.
5. **It is transparent.** Every agent logs what it is doing in real time. You are never just waiting for a black box.

---

## Potential Future Improvements

- **Cross-session graph merging** — combine knowledge graphs from multiple sessions into one super-graph
- **Citation export** — generate BibTeX references for all fetched papers
- **Semantic Scholar / PubMed integration** — support domains beyond arXiv
- **Collaborative sessions** — share a session link with a colleague
- **Hypothesis validation agent** — automatically search for prior work that supports or refutes the generated hypothesis

---

## License

MIT — free to use, modify, and build upon.

---

*Built with curiosity, FastAPI, React, and Gemini. Hackathon project — May 2026.*
