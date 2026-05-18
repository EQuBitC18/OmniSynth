# OmniSynth — AI-Powered Research Intelligence Platform

> *From a research question to a full literature synthesis, knowledge graph, gap analysis, and novel hypothesis — in under 5 minutes.*

OmniSynth is a multi-agent AI system built for researchers, students, and curious minds who want to understand a scientific topic quickly and deeply. Instead of spending hours searching databases, reading papers, and connecting the dots manually, you type one question and OmniSynth orchestrates seven specialised AI agents to do it for you.

---

## What Problem Does It Solve?

A typical literature review looks like this:

1. Search Google Scholar / arXiv for relevant papers
2. Open 10+ browser tabs, skim abstracts
3. Read the promising ones in full (2–4 hours)
4. Take notes, identify key concepts and relationships
5. Spot gaps in the literature
6. Formulate a research hypothesis
7. Write a structured research brief

OmniSynth compresses steps 1–7 into a single automated pipeline that runs in approximately **4–6 minutes** — giving you more time for the parts of research that actually require human insight.

---

## Key Features

| Feature | Description |
|---|---|
| **7-Agent Pipeline** | Orchestrator, Fetch, Ingestor, Synthesizer, Lint, Hypothesis, Writer agents work in sequence |
| **Live Knowledge Graph** | Interactive node-link graph of concepts extracted from the literature |
| **Research Gap Detection** | AI identifies unexplored areas and missing connections in the field |
| **Novel Hypothesis Generation** | Produces structured, testable scientific hypotheses |
| **IMRaD Research Brief** | Full professional research brief auto-drafted from all compiled knowledge |
| **Session History** | Every run is saved to SQLite — browse, revisit, and compare past sessions |
| **Chat Interface** | Ask follow-up questions about the compiled knowledge base |
| **Tunable Parameters** | 8 pipeline settings (papers, temperature, model, format, etc.) |
| **Live Metrics Strip** | Real-time performance statistics at the bottom of the screen |
| **File Editor** | Edit any generated file directly in the browser |

---

## How It Works — The Pipeline

When you press Enter on a research question, the following happens automatically:

```
User Query
    │
    ▼
┌─────────────────┐
│  Orchestrator   │  Routes the query, coordinates all agents, signals completion
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│   Fetch Agent   │  Searches arXiv, downloads paper abstracts as .txt files
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ Ingestor Agent  │  Converts each abstract into a structured markdown wiki page
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
│  Writer Agent   │  Drafts the final research brief (IMRaD / Executive / Bullets)
└────────┬────────┘
         │
    ▼
Session saved to SQLite database
```

Each agent broadcasts its status in real time over a WebSocket connection, so you watch the pipeline progress live in the sidebar.

---

## Tech Stack

### Backend
| Library | Role |
|---|---|
| **FastAPI** | REST API + WebSocket server |
| **Google Gemini 2.5** | LLM powering all AI agents (Flash or Pro) |
| **google-genai SDK** | Gemini API client with structured output |
| **arxiv** | arXiv API client for paper fetching |
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
│   ├── agents.py        # OmniSynthAgents class — the full 7-agent pipeline
│   ├── database.py      # SQLite helpers: init, save, query, metrics
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
├── raw/             # Downloaded arXiv abstracts (.txt)
├── wikis/           # AI-generated wiki pages (.md)
├── briefs/          # Research brief (.md)
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

### Running your first query

1. Type a research question in the search bar at the top (e.g., *"How do transformer architectures handle long-range dependencies?"*)
2. Press **Enter**
3. Watch the 7 agents run live in the left sidebar
4. When complete, the knowledge graph appears in the left pane and the research brief opens in the right pane
5. Browse the generated files in the **Knowledge Base** sidebar on the right

### Reading the Knowledge Graph

The graph shows concepts extracted from the literature as nodes, connected by semantic relationships.

| Colour | Type | Meaning |
|---|---|---|
| Purple | Core Topic | Central concepts defined in the query domain |
| Green | Method | Techniques, approaches, and algorithms |
| Red | Finding | Experimental results, conclusions, outcomes |

- **Click a node** to see its AI-generated description and its connections
- **Click a connected node name** in the panel to hop to that node
- **Click ⓘ** (top-right of graph) for an explanation of the graph structure
- **Drag** to pan, **scroll** to zoom

### Chat with the Knowledge Base

Click the blue chat bubble (bottom-right of the graph) to open the chat interface. Ask any question about the compiled research — the AI answers using only the content from the current session's knowledge base.

When viewing a historical session, the chat uses that session's data automatically.

### Session History

Every completed pipeline run is saved. Click any session in the **History** panel (right sidebar, bottom) to reload that session's graph, brief, wikis, hypotheses, and gaps. The metrics bar updates to reflect the loaded session's context.

Delete sessions with the X button — a confirmation dialog prevents accidents.

---

## Pipeline Settings

Click the **⊟ sliders icon** next to the search bar to configure the pipeline before running:

| Setting | Options | Effect |
|---|---|---|
| **Papers to fetch** | 1–10 | More papers = richer graph, longer runtime |
| **Temperature** | 0.0–1.0 | Low = precise/factual output; High = creative/exploratory |
| **Sort order** | Relevance / Most Recent | How arXiv ranks the returned papers |
| **Model** | Flash / Pro | Flash is faster and cheaper; Pro produces more nuanced output |
| **Research gaps** | 1–5 | How many gap sections to identify |
| **Hypotheses** | 1–3 | Number of hypotheses to generate |
| **Wiki detail** | Brief / Standard / Detailed | Controls the depth of each wiki page |
| **Brief format** | IMRaD / Executive Summary / Bullet Points | Output style of the final research brief |

Settings are preserved for the current session but reset to defaults on page reload.

---

## Performance Metrics

Click the **📊 bar chart icon** next to the sliders to open the metrics panel. Here is exactly how each number is calculated:

### Total Runs
```
COUNT(*) FROM sessions
```
Every row in the `sessions` table represents one pipeline execution (including failed ones).

### Success Rate
```
(successful_runs / total_runs) × 100
```
A run is "successful" if it has a non-null `metrics` field in the database — meaning the pipeline completed far enough to save timing and paper data.

### Avg. Pipeline Time
```
SUM(metrics.total_time_seconds) / successful_runs
```
Measured from the first `log_step` call in `_pipeline()` to the final line before the database save. Recorded in seconds using `time.time()`.

### Papers Processed
```
SUM(metrics.papers_processed) across all successful runs
```
Each `metrics.papers_processed` = `len(raw_files)` — the number of arXiv abstracts actually downloaded and saved.

### Avg. Graph Nodes
```
SUM(metrics.graph_nodes) / successful_runs
```
`metrics.graph_nodes` = `len(graph_data["nodes"])` after the Synthesizer Agent runs.

### Steps Automated
Fixed at **7** — one for each agent in the pipeline (Orchestrator, Fetch, Ingestor, Synthesizer, Lint, Hypothesis, Writer). Every single run automates all 7 steps without human intervention.

### Time Saved / Run
```
max(1,  60 - round(avg_time_seconds / 60))  minutes
```
Baseline of **60 minutes** represents a conservative estimate of a manual literature review (searching, reading 3 papers, note-taking, gap identification, hypothesis drafting). Subtract the average pipeline time to get estimated savings.

### Sessions Saved
```
COUNT(*) FROM sessions WHERE metrics IS NOT NULL
```
Runs where the full pipeline completed and data was persisted to SQLite.

---

## Edge Cases Handled

| Situation | Behaviour |
|---|---|
| arXiv HTTP 500 (bad query) | Fetch Agent reports error with human-readable message, pipeline aborts cleanly |
| arXiv HTTP 429 (rate limit) | Waits 30 s, retries, waits 60 s, retries again before giving up |
| Gemini API 429 (rate limit) | Retries after 20 s, then 45 s, then raises an error to the orchestrator |
| Invalid API key | `self.client` is None — returns mock output with a clear message |
| Query returns 0 papers | Fetch Agent reports "No papers found" and aborts |
| arXiv paper ID contains `/` (old format) | Sanitised with `.replace('/', '_')` before writing to disk |
| LLM returns malformed JSON (graph) | Caught by try/except, falls back to empty graph `{"nodes": [], "links": []}` |
| Pipeline crash anywhere | Top-level try/except in `run_pipeline` broadcasts error to frontend |
| React StrictMode double WebSocket | Cleanup closes socket regardless of `readyState` (0 = CONNECTING, 1 = OPEN) |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/query` | Start a pipeline run |
| `GET` | `/api/files` | List all files in raw/, wikis/, briefs/, hypotheses/, gaps/ |
| `GET` | `/api/graph` | Return the latest knowledge graph JSON |
| `GET` | `/api/brief/{filename}` | Get brief file content |
| `GET` | `/api/wiki/{filename}` | Get wiki file content |
| `GET` | `/api/raw/{filename}` | Get raw abstract content |
| `GET` | `/api/hypothesis/{filename}` | Get hypothesis file content |
| `GET` | `/api/gaps/{filename}` | Get gaps file content |
| `PUT` | `/api/file/{folder}/{filename}` | Save / create a file |
| `POST` | `/api/chat` | Chat with the knowledge base |
| `POST` | `/api/node-description` | Get AI description for a graph node |
| `GET` | `/api/sessions` | List all session history |
| `GET` | `/api/sessions/{id}` | Get full session data |
| `DELETE` | `/api/sessions/{id}` | Delete a session |
| `GET` | `/api/metrics` | Get aggregate performance metrics |
| `WS` | `/ws/logs` | Real-time agent log stream |

---

## Why OmniSynth Stands Out

Most AI research tools are either glorified search engines or single-prompt summarisers. OmniSynth is different because:

1. **It reasons across papers, not just within one.** The Synthesizer builds a graph connecting concepts from multiple sources, revealing relationships no single paper would show.
2. **It identifies what is missing, not just what exists.** The Lint Agent specifically looks for gaps — the blind spots in a field.
3. **It produces actionable output.** The hypothesis is formatted with a statement, rationale, expected impact, and testability criteria — ready to be the starting point for a grant proposal or experiment.
4. **Everything is persistent and revisitable.** Sessions are stored in SQLite so you can compare how your understanding of a topic evolved across different queries.
5. **It is transparent.** Every agent logs what it's doing in real time. You are never just waiting for a black box.

---

## Potential Future Improvements

- **PDF upload support** — feed full papers, not just arXiv abstracts
- **Cross-session graph merging** — combine knowledge graphs from multiple queries into one super-graph
- **Citation export** — generate BibTeX references for all fetched papers
- **Semantic Scholar / PubMed integration** — support domains beyond physics/CS/math
- **Collaborative sessions** — share a session link with a colleague
- **Hypothesis validation agent** — automatically search for prior work that supports or refutes the generated hypothesis

---

## License

MIT — free to use, modify, and build upon.

---

*Built with curiosity, FastAPI, React, and Gemini. Hackathon project — May 2026.*
