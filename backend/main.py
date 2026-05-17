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
    query: str

class ChatRequest(BaseModel):
    message: str
    session_id: int | None = None

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
    asyncio.create_task(agents_system.run_pipeline(request.query, manager.broadcast))

    return {"status": "pipeline_started"}

import os
import json
from fastapi import HTTPException

@app.get("/api/files")
async def get_files():
    files = {"raw": [], "wikis": [], "briefs": []}
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

@app.get("/api/sessions")
async def get_sessions():
    return database.list_sessions()

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: int):
    session = database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
