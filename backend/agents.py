import os
import json
import asyncio
import networkx as nx
import arxiv

# Define the models
DEFAULT_MODEL = "gemini-2.5-flash"
REASONING_MODEL = "gemini-2.5-flash" # For Hypothesis and Synthesizer as per user specs

class OmniSynthAgents:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if self.api_key:
            from google import genai
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None
        self.graph = nx.Graph()

    def _setup_folders(self):
        for folder in ['raw', 'wikis', 'briefs']:
            os.makedirs(folder, exist_ok=True)
            # Clear old files to ensure fresh run
            for file in os.listdir(folder):
                try:
                    os.remove(os.path.join(folder, file))
                except:
                    pass

    async def _call_llm(self, prompt: str, system_instruction: str = None, response_schema=None) -> str:
        if not self.client:
            await asyncio.sleep(1)
            return "Mocked output (No API Key)"
            
        loop = asyncio.get_event_loop()
        def sync_call():
            from google.genai import types
            config_kwargs = {"temperature": 0.2}
            if system_instruction:
                config_kwargs["system_instruction"] = system_instruction
            if response_schema:
                config_kwargs["response_mime_type"] = "application/json"
                config_kwargs["response_schema"] = response_schema
                
            config = types.GenerateContentConfig(**config_kwargs)
            response = self.client.models.generate_content(
                model=DEFAULT_MODEL,
                contents=prompt,
                config=config,
            )
            return response.text
            
        return await loop.run_in_executor(None, sync_call)

    async def run_pipeline(self, user_query: str, broadcast_callback=None):
        import database
        collected_logs = []

        async def log_step(agent, status, message, graph_data=None):
            collected_logs.append({"agent": agent, "status": status, "log": message})
            if broadcast_callback:
                payload = {
                    "type": "status",
                    "agent": agent,
                    "status": status,
                    "log": message
                }
                if graph_data:
                    payload["graph_data"] = graph_data
                await broadcast_callback(payload)

        self._setup_folders()

        # Orchestrator received query
        await log_step("orchestrator", "running", f"Routing query: {user_query}")
        await asyncio.sleep(0.5)
        await log_step("orchestrator", "success", "Query analyzed. Initiating pipeline.")

        # Fetch Agent
        await log_step("fetch", "running", "Searching arXiv for literature...")
        loop = asyncio.get_event_loop()
        
        def fetch_arxiv():
            client = arxiv.Client()
            search = arxiv.Search(query=user_query, max_results=3, sort_by=arxiv.SortCriterion.Relevance)
            papers = list(client.results(search))
            saved_paths = []
            for i, p in enumerate(papers):
                safe_id = p.get_short_id().replace('/', '_').replace(':', '_')[:15]
                filename = f"raw/arxiv_{safe_id}.txt"
                with open(filename, "w", encoding='utf-8') as f:
                    f.write(f"Title: {p.title}\nAuthors: {[a.name for a in p.authors]}\nAbstract: {p.summary}\n")
                saved_paths.append(filename)
            return saved_paths

        raw_files = await loop.run_in_executor(None, fetch_arxiv)
        await log_step("fetch", "success", f"Downloaded {len(raw_files)} abstracts.")

        # Ingestor Agent
        await log_step("ingestor", "running", "Compiling raw abstracts into markdown wikis...")
        wiki_files = []
        for raw_file in raw_files:
            with open(raw_file, "r", encoding='utf-8') as f:
                content = f.read()
            
            prompt = f"Convert this academic text into a structured markdown wiki page. Extract the core concept, methodology, and key findings. Text:\n{content}"
            wiki_content = await self._call_llm(prompt, "You are an expert academic summarizer.")
            
            wiki_filename = raw_file.replace('raw/', 'wikis/').replace('.txt', '.md')
            with open(wiki_filename, "w", encoding='utf-8') as f:
                f.write(wiki_content)
                wiki_files.append(wiki_filename)
        await log_step("ingestor", "success", "Wikis successfully compiled.")

        # Synthesizer Agent
        await log_step("synthesizer", "running", "Extracting Knowledge Graph from wikis...")
        all_wikis = ""
        for w in wiki_files:
            with open(w, "r", encoding='utf-8') as f:
                all_wikis += f.read() + "\n\n"

        graph_prompt = f"""
        Extract the core concepts and their relationships from these wikis. 
        Return a JSON object with 'nodes' (list of {{id, name, group}}) and 'links' (list of {{source, target}}). 
        Use group 1 for core topics, group 2 for methods, group 3 for findings.
        Wikis: {all_wikis}
        """
        
        # Define JSON schema for structured output
        schema = {
            "type": "OBJECT",
            "properties": {
                "nodes": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "id": {"type": "STRING"},
                            "name": {"type": "STRING"},
                            "group": {"type": "INTEGER"}
                        }
                    }
                },
                "links": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "source": {"type": "STRING"},
                            "target": {"type": "STRING"}
                        }
                    }
                }
            }
        }
        
        graph_json_str = await self._call_llm(graph_prompt, "You are a graph extraction engine.", response_schema=schema)
        try:
            graph_data = json.loads(graph_json_str)
        except Exception:
            graph_data = {"nodes": [], "links": []}

        with open("graph.json", "w", encoding="utf-8") as f:
            json.dump(graph_data, f)

        await log_step("synthesizer", "success", "Knowledge Graph compiled and linked.", graph_data=graph_data)

        # Lint Agent
        await log_step("lint", "running", "Detecting gaps in the current knowledge topology...")
        gap_prompt = f"Analyze this knowledge graph JSON. What are the missing links or unexplored areas? Return a short summary of 2 gaps. Graph: {graph_json_str}"
        gaps_text = await self._call_llm(gap_prompt, "You are a critical literature review bot.")
        with open("gaps.json", "w", encoding='utf-8') as f:
            json.dump({"gaps": gaps_text}, f)
        await log_step("lint", "success", "Identified structural gaps in the literature.")

        # Hypothesis Agent
        await log_step("hypothesis", "running", "Generating hypotheses based on detected gaps...")
        hypo_prompt = f"Based on these research gaps, generate 1 novel, highly impactful scientific hypothesis. Gaps: {gaps_text}"
        hypothesis_text = await self._call_llm(hypo_prompt, "You are an elite scientific visionary.")
        with open("hypotheses.json", "w", encoding='utf-8') as f:
            json.dump({"hypothesis": hypothesis_text}, f)
        await log_step("hypothesis", "success", "Generated 1 novel hypothesis.")

        # Writer Agent
        await log_step("writer", "running", "Drafting final research brief...")
        brief_prompt = f"Write a professional, IMRaD-style research brief combining these wikis, gaps, and the novel hypothesis.\nWikis:\n{all_wikis}\nHypothesis:\n{hypothesis_text}"
        brief_content = await self._call_llm(brief_prompt, "You are an expert scientific author.")
        
        with open("briefs/brief.md", "w", encoding='utf-8') as f:
            f.write(brief_content)
        await log_step("writer", "success", "Research brief 'brief.md' completed.")
        await log_step("orchestrator", "success", "Pipeline execution finished successfully.")

        # Persist session to SQLite
        try:
            raw_file_data = []
            for path in raw_files:
                with open(path, encoding="utf-8") as f:
                    raw_file_data.append({"filename": os.path.basename(path), "content": f.read()})

            wiki_file_data = []
            for path in wiki_files:
                with open(path, encoding="utf-8") as f:
                    wiki_file_data.append({"filename": os.path.basename(path), "content": f.read()})

            database.save_session(
                query=user_query,
                graph_data=graph_data,
                brief=brief_content,
                hypothesis=hypothesis_text,
                gaps=gaps_text,
                raw_files=raw_file_data,
                wiki_files=wiki_file_data,
                agent_logs=collected_logs,
            )
        except Exception as e:
            print(f"[DB] Failed to save session: {e}")
