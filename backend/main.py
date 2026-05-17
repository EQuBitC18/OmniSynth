from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
from agents import OmniSynthAgents

app = FastAPI(title="OmniSynth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    query: str

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
            data = await websocket.receive_text()
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

@app.get("/api/files")
async def get_files():
    files = {"raw": [], "wikis": [], "briefs": []}
    for folder in files.keys():
        if os.path.exists(folder):
            files[folder] = os.listdir(folder)
    return files

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
