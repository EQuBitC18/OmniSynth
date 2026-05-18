from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
from agents import OmniSynthAgents
import database

app = FastAPI(title="OmniSynth API")
database.init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    query: str = ""
    session_id:     int | None = None
    papers_count:   int   = 3
    sort_order:     str   = "relevance"
    num_gaps:       int   = 2
    num_hypotheses: int   = 1
    temperature:    float = 0.2
    model_tier:     str   = "flash"
    wiki_detail:    str   = "standard"
    brief_format:   str   = "imrad"

class ChatRequest(BaseModel):
    message: str
    session_id: int | None = None

class NodeDescriptionRequest(BaseModel):
    node_name: str
    node_type: str

class FileSaveRequest(BaseModel):
    content: str

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()
agents_system = OmniSynthAgents()

@app.websocket("/ws/logs")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/query")
async def submit_query(request: QueryRequest):
    """
    Endpoint to trigger the OmniSynth pipeline.
    """
    await manager.broadcast({"type": "info", "text": f"Received query: {request.query}"})
    
    # Launch the pipeline in the background so the HTTP request returns immediately
    config = request.model_dump(exclude={'query', 'session_id'})
    asyncio.create_task(agents_system.run_pipeline(
        request.query, manager.broadcast, config=config, session_id=request.session_id
    ))

    return {"status": "pipeline_started"}

import os
import json
import time as _time
import asyncio as _asyncio
import arxiv
import pypdf
from fastapi import HTTPException, UploadFile, File

@app.get("/api/files")
async def get_files():
    files = {"raw": [], "wikis": [], "briefs": [], "hypotheses": [], "gaps": []}
    for folder in files.keys():
        if os.path.exists(folder):
            files[folder] = os.listdir(folder)
    return files

@app.get("/api/graph")
async def get_graph():
    if os.path.exists("graph.json"):
        with open("graph.json", encoding="utf-8") as f:
            return json.load(f)
    return {"nodes": [], "links": []}

def _read_folder_file(folder: str, filename: str):
    safe_name = os.path.basename(filename)
    path = os.path.join(folder, safe_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    if safe_name.lower().endswith(".pdf"):
        from fastapi.responses import FileResponse
        return FileResponse(path, media_type="application/pdf", filename=safe_name)
    with open(path, encoding="utf-8") as f:
        return {"content": f.read()}

@app.get("/api/brief/{filename}")
async def get_brief(filename: str):
    return _read_folder_file("briefs", filename)

@app.get("/api/wiki/{filename}")
async def get_wiki(filename: str):
    return _read_folder_file("wikis", filename)

@app.get("/api/raw/{filename}")
async def get_raw(filename: str):
    return _read_folder_file("raw", filename)

@app.get("/api/hypothesis/{filename}")
async def get_hypothesis(filename: str):
    return _read_folder_file("hypotheses", filename)

@app.get("/api/gaps/{filename}")
async def get_gaps_file(filename: str):
    return _read_folder_file("gaps", filename)

@app.post("/api/node-description")
async def node_description(request: NodeDescriptionRequest):
    prompt = (
        f'In exactly 2 concise sentences, explain what "{request.node_name}" is '
        f'as a {request.node_type} concept in academic research. '
        f'Be specific and factual. Do not start with "I".'
    )
    description = await agents_system._call_llm(
        prompt,
        "You are a scientific knowledge assistant. Give brief, accurate concept definitions."
    )
    return {"description": description}

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    context_parts = []

    if request.session_id:
        session = database.get_session(request.session_id)
        if session:
            if session.get("brief"):
                context_parts.append(f"RESEARCH BRIEF:\n{session['brief']}")
            for wiki in (session.get("wiki_files") or []):
                context_parts.append(f"WIKI [{wiki['filename']}]:\n{wiki['content']}")
            if session.get("hypothesis"):
                context_parts.append(f"HYPOTHESIS:\n{session['hypothesis']}")
    else:
        if os.path.exists("briefs/brief.md"):
            with open("briefs/brief.md", encoding="utf-8") as f:
                context_parts.append(f"RESEARCH BRIEF:\n{f.read()}")
        if os.path.exists("wikis"):
            for fn in sorted(os.listdir("wikis")):
                with open(f"wikis/{fn}", encoding="utf-8") as f:
                    context_parts.append(f"WIKI [{fn}]:\n{f.read()}")
        if os.path.exists("hypotheses.json"):
            with open("hypotheses.json", encoding="utf-8") as f:
                hyp = json.load(f)
                context_parts.append(f"HYPOTHESIS:\n{hyp.get('hypothesis', '')}")

    if not context_parts:
        return {"response": "No knowledge base is loaded yet. Please run a research query first."}

    context = "\n\n---\n\n".join(context_parts)
    prompt = (
        f"You are a research assistant with access to the following compiled knowledge base.\n\n"
        f"KNOWLEDGE BASE:\n{context}\n\n"
        f"USER QUESTION: {request.message}\n\n"
        f"Answer accurately and concisely based on the knowledge base above."
    )
    response = await agents_system._call_llm(
        prompt,
        "You are a helpful, precise research assistant. Answer only from the provided knowledge base."
    )
    return {"response": response}

ALLOWED_FOLDERS = {"raw", "wikis", "briefs", "hypotheses", "gaps"}

@app.put("/api/file/{folder}/{filename}")
async def save_file(folder: str, filename: str, request: FileSaveRequest):
    if folder not in ALLOWED_FOLDERS:
        raise HTTPException(status_code=400, detail="Invalid folder")
    safe_name = os.path.basename(filename)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, safe_name), "w", encoding="utf-8") as f:
        f.write(request.content)
    return {"status": "saved"}

@app.delete("/api/file/{folder}/{filename}")
async def delete_file(folder: str, filename: str):
    if folder not in ALLOWED_FOLDERS:
        raise HTTPException(status_code=400, detail="Invalid folder")
    path = os.path.join(folder, os.path.basename(filename))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    os.remove(path)
    return {"status": "deleted"}

@app.get("/api/metrics")
async def get_metrics():
    return database.get_aggregate_metrics()

# ── Paper ingestion endpoints ─────────────────────────────────────────────────

class ArxivSearchRequest(BaseModel):
    query:      str
    count:      int  = 3
    sort_order: str  = "relevance"   # "relevance" | "recent"

@app.post("/api/arxiv-search")
async def arxiv_search(request: ArxivSearchRequest):
    """Download full-text arXiv papers into raw/ (with PDF extraction)."""
    def do_fetch():
        _time.sleep(3)
        sort = (arxiv.SortCriterion.SubmittedDate
                if request.sort_order == "recent"
                else arxiv.SortCriterion.Relevance)
        client = arxiv.Client(delay_seconds=5.0, num_retries=5)
        search = arxiv.Search(query=request.query,
                              max_results=request.count, sort_by=sort)
        papers = list(client.results(search))

        os.makedirs("raw", exist_ok=True)
        saved = []
        for p in papers:
            safe_id = p.get_short_id().replace("/", "_").replace(":", "_")[:15]
            txt_path = f"raw/arxiv_{safe_id}.txt"
            if os.path.exists(txt_path):
                saved.append({"filename": os.path.basename(txt_path), "status": "existing"})
                continue

            text = ""
            pdf_tmp = f"raw/arxiv_{safe_id}_tmp.pdf"
            try:
                p.download_pdf(dirpath="raw", filename=f"arxiv_{safe_id}_tmp.pdf")
                reader = pypdf.PdfReader(pdf_tmp)
                text = "\n\n".join(
                    pg.extract_text() or "" for pg in reader.pages[:60]
                ).strip()
                os.remove(pdf_tmp)
            except Exception:
                if os.path.exists(pdf_tmp):
                    os.remove(pdf_tmp)

            if len(text) < 200:
                # Fallback to abstract when PDF extraction yields too little
                text = (f"Title: {p.title}\n"
                        f"Authors: {[a.name for a in p.authors]}\n"
                        f"Abstract: {p.summary}\n")
            else:
                text = (f"Title: {p.title}\n"
                        f"Authors: {[a.name for a in p.authors]}\n\n"
                        + text)

            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)
            saved.append({"filename": os.path.basename(txt_path), "status": "new"})

        return saved

    loop = _asyncio.get_event_loop()
    try:
        saved = await loop.run_in_executor(None, do_fetch)
        return {"files": saved}
    except arxiv.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"arXiv API error (HTTP {e.status})")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload/raw")
async def upload_raw(file: UploadFile = File(...)):
    """Upload a paper (PDF or text) into raw/."""
    safe_name = os.path.basename(file.filename or "upload.bin")
    content_bytes = await file.read()
    os.makedirs("raw", exist_ok=True)
    with open(f"raw/{safe_name}", "wb") as f:
        f.write(content_bytes)
    return {"filename": safe_name}

@app.post("/api/sessions/new")
async def new_session():
    session_id = database.create_blank_session()
    row = database.get_session(session_id)
    return {"id": row["id"], "query": row["query"], "created_at": row["created_at"]}

@app.get("/api/sessions")
async def get_sessions():
    return database.list_sessions()

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: int):
    session = database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int):
    database.delete_session(session_id)
    return {"status": "deleted"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
