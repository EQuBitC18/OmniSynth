import os
import json
import time
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
        for folder in ['raw', 'wikis', 'briefs', 'hypotheses', 'gaps']:
            os.makedirs(folder, exist_ok=True)
            for file in os.listdir(folder):
                try:
                    os.remove(os.path.join(folder, file))
                except:
                    pass

    async def _call_llm(self, prompt: str, system_instruction: str = None, response_schema=None,
                         temperature: float = 0.2, model: str = None) -> str:
        if not self.client:
            await asyncio.sleep(1)
            return "Mocked output (No API Key)"

        _model = model or DEFAULT_MODEL
        loop = asyncio.get_event_loop()
        def sync_call():
            from google.genai import types
            config_kwargs = {"temperature": temperature}
            if system_instruction:
                config_kwargs["system_instruction"] = system_instruction
            if response_schema:
                config_kwargs["response_mime_type"] = "application/json"
                config_kwargs["response_schema"] = response_schema
            cfg = types.GenerateContentConfig(**config_kwargs)
            response = self.client.models.generate_content(
                model=_model,
                contents=prompt,
                config=cfg,
            )
            return response.text

        # Retry up to 3 times on rate-limit (429 / RESOURCE_EXHAUSTED)
        retry_delays = [20, 45]
        for attempt in range(3):
            try:
                return await loop.run_in_executor(None, sync_call)
            except Exception as e:
                is_rate_limit = "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)
                if is_rate_limit and attempt < len(retry_delays):
                    wait = retry_delays[attempt]
                    print(f"[LLM] Rate limited (429). Retrying in {wait}s (attempt {attempt + 1}/3)…")
                    await asyncio.sleep(wait)
                else:
                    raise

    async def run_pipeline(self, user_query: str, broadcast_callback=None, config: dict = None):
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

        try:
            await self._pipeline(user_query, log_step, database, collected_logs, config or {})
        except Exception as e:
            err = str(e)
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                msg = "Gemini API rate limit reached (429). Wait a minute and try again."
            else:
                msg = f"Pipeline error: {err}"
            await log_step("orchestrator", "error", msg)
            return

    async def _pipeline(self, user_query, log_step, database, collected_logs, config):
        t_start = time.time()
        agent_timings = {}   # agent_id -> seconds

        _orig_log = log_step
        _agent_t  = {}

        async def log_step(agent, status, message, graph_data=None):
            if status == 'running':
                _agent_t[agent] = time.time()
            elif status in ('success', 'error') and agent in _agent_t:
                agent_timings[agent] = round(time.time() - _agent_t[agent], 1)
            await _orig_log(agent, status, message, graph_data)

        # ── Unpack config ──────────────────────────────────────────────────────
        papers_count   = max(1, min(10, int(config.get('papers_count',   3))))
        sort_order     = config.get('sort_order',   'relevance')
        num_gaps       = max(1, min(5,  int(config.get('num_gaps',       2))))
        num_hypotheses = max(1, min(3,  int(config.get('num_hypotheses', 1))))
        temperature    = max(0.0, min(1.0, float(config.get('temperature', 0.2))))
        model_tier     = config.get('model_tier',   'flash')
        wiki_detail    = config.get('wiki_detail',  'standard')
        brief_format   = config.get('brief_format', 'imrad')

        model = {'flash': 'gemini-2.5-flash', 'pro': 'gemini-2.5-pro'}.get(model_tier, 'gemini-2.5-flash')

        # Convenience wrapper so every LLM call uses the user's temperature/model
        async def llm(prompt, sys=None, schema=None):
            return await self._call_llm(prompt, sys, schema, temperature=temperature, model=model)

        WIKI_PROMPTS = {
            'brief':    'Summarize this academic text as 3-5 concise bullet points covering the core concept and main finding.',
            'standard': 'Convert this academic text into a structured markdown wiki page. Extract the core concept, methodology, and key findings.',
            'detailed': 'Convert this academic text into a comprehensive markdown wiki with sections: Overview, Background, Methodology, Key Findings, Limitations, and Significance. Be thorough.',
        }
        BRIEF_PROMPTS = {
            'imrad':     'Write a professional IMRaD-style research brief (Introduction, Methods, Results, Discussion) combining these wikis, gaps, and novel hypothesis.',
            'executive': 'Write a concise executive summary (400-600 words) for decision-makers, covering research context, key findings, the novel hypothesis, and strategic implications.',
            'bullets':   'Produce a structured bullet-point research report with sections: Background, Key Papers, Knowledge Gaps, Novel Hypothesis, and Recommended Next Steps.',
        }

        # Orchestrator received query
        await log_step("orchestrator", "running", f"Routing query: {user_query}")
        await asyncio.sleep(0.5)
        await log_step("orchestrator", "success", "Query analyzed. Initiating pipeline.")

        # Fetch Agent
        await log_step("fetch", "running", "Searching arXiv for literature...")
        loop = asyncio.get_event_loop()

        def fetch_arxiv():
            # Polite delay before every request — reduces chance of hitting arXiv rate limits
            time.sleep(3)
            sort_criterion = (arxiv.SortCriterion.SubmittedDate
                              if sort_order == 'recent'
                              else arxiv.SortCriterion.Relevance)
            # delay_seconds pauses between paginated fetches; num_retries handles transient failures
            client = arxiv.Client(delay_seconds=5.0, num_retries=5)
            search = arxiv.Search(query=user_query, max_results=papers_count, sort_by=sort_criterion)
            papers = list(client.results(search))
            saved_paths = []
            for p in papers:
                safe_id = p.get_short_id().replace('/', '_').replace(':', '_')[:15]
                filename = f"raw/arxiv_{safe_id}.txt"
                with open(filename, "w", encoding='utf-8') as f:
                    f.write(f"Title: {p.title}\nAuthors: {[a.name for a in p.authors]}\nAbstract: {p.summary}\n")
                saved_paths.append(filename)
            return saved_paths

        # Up to 3 attempts with exponential back-off on 429
        raw_files = None
        for fetch_attempt in range(3):
            try:
                raw_files = await loop.run_in_executor(None, fetch_arxiv)
                break
            except arxiv.HTTPError as e:
                if e.status == 429 and fetch_attempt < 2:
                    wait = 30 * (fetch_attempt + 1)   # 30 s, then 60 s
                    await log_step("fetch", "running",
                                   f"arXiv rate limit hit. Waiting {wait}s before retry {fetch_attempt + 2}/3…")
                    await asyncio.sleep(wait)
                else:
                    await log_step("fetch", "error",
                                   f"arXiv API error (HTTP {e.status}). Try a more specific academic query.")
                    return
            except Exception as e:
                await log_step("fetch", "error", f"Failed to fetch from arXiv: {e}")
                return

        if not raw_files:
            await log_step("fetch", "error", "No papers found for this query. Try different keywords.")
            return

        await log_step("fetch", "success", f"Downloaded {len(raw_files)} abstracts.")

        # Ingestor Agent
        await log_step("ingestor", "running", "Compiling raw abstracts into markdown wikis...")
        wiki_files = []
        for raw_file in raw_files:
            with open(raw_file, "r", encoding='utf-8') as f:
                content = f.read()
            
            prompt = f"{WIKI_PROMPTS.get(wiki_detail, WIKI_PROMPTS['standard'])}\n\nText:\n{content}"
            wiki_content = await llm(prompt, "You are an expert academic summarizer.")
            
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
        
        graph_json_str = await llm(graph_prompt, "You are a graph extraction engine.", schema)
        try:
            graph_data = json.loads(graph_json_str)
        except Exception:
            graph_data = {"nodes": [], "links": []}

        with open("graph.json", "w", encoding="utf-8") as f:
            json.dump(graph_data, f)

        await log_step("synthesizer", "success", "Knowledge Graph compiled and linked.", graph_data=graph_data)

        # Lint Agent
        await log_step("lint", "running", "Detecting gaps in the current knowledge topology...")
        gap_prompt = (
            f"Analyze this knowledge graph and identify {num_gaps} significant research gaps or unexplored areas. "
            f"Format your response as clean markdown:\n"
            f"- Start with one sentence summarising the overall topology\n"
            f"- Use a ## header for each gap (e.g. ## Gap 1: <Title>)\n"
            f"- Under each gap: 2-3 sentences of explanation, then a short **Implications:** note\n"
            f"Graph JSON: {graph_json_str}"
        )
        gaps_text = await llm(gap_prompt, "You are a critical literature review specialist.")
        gaps_md = (
            "# Research Gap Analysis\n\n"
            "*Automated topology analysis of the compiled knowledge graph*\n\n"
            "---\n\n"
            f"{gaps_text}"
        )
        with open("gaps/gaps.md", "w", encoding="utf-8") as f:
            f.write(gaps_md)
        with open("gaps.json", "w", encoding="utf-8") as f:
            json.dump({"gaps": gaps_text}, f)
        await log_step("lint", "success", "Identified structural gaps in the literature.")

        # Hypothesis Agent
        await log_step("hypothesis", "running", "Generating hypotheses based on detected gaps...")
        hypo_noun = "hypothesis" if num_hypotheses == 1 else "hypotheses"
        hypo_prompt = (
            f"Based on these research gaps, generate {num_hypotheses} novel, highly impactful scientific {hypo_noun}. "
            f"For each, use clean markdown with exactly these sections:\n"
            f"## Hypothesis Statement\n(one bold, precise sentence)\n\n"
            f"## Rationale\n(2-3 sentences connecting it to the identified gaps)\n\n"
            f"## Expected Impact\n(1-2 sentences on scientific significance)\n\n"
            f"## Testability\n(brief note on how it could be empirically tested)\n\n"
            f"Gaps:\n{gaps_text}"
        )
        hypothesis_text = await llm(hypo_prompt, "You are an elite scientific visionary.")
        hypothesis_md = (
            "# Novel Research Hypothesis\n\n"
            "*Generated by OmniSynth from identified knowledge gaps*\n\n"
            "---\n\n"
            f"{hypothesis_text}"
        )
        with open("hypotheses/hypothesis.md", "w", encoding="utf-8") as f:
            f.write(hypothesis_md)
        with open("hypotheses.json", "w", encoding="utf-8") as f:
            json.dump({"hypothesis": hypothesis_text}, f)
        await log_step("hypothesis", "success", "Generated 1 novel hypothesis.")

        # Writer Agent
        await log_step("writer", "running", "Drafting final research brief...")
        brief_prompt = (
            f"{BRIEF_PROMPTS.get(brief_format, BRIEF_PROMPTS['imrad'])}\n\n"
            f"Wikis:\n{all_wikis}\n\nGaps:\n{gaps_text}\n\nHypothesis:\n{hypothesis_text}"
        )
        brief_content = await llm(brief_prompt, "You are an expert scientific author.")
        
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

            run_metrics = {
                "total_time_seconds": round(time.time() - t_start, 1),
                "papers_processed":   len(raw_files),
                "wikis_generated":    len(wiki_files),
                "graph_nodes":        len(graph_data.get("nodes", [])),
                "graph_links":        len(graph_data.get("links", [])),
                "steps_completed":    sum(1 for l in collected_logs if l["status"] == "success"),
                "agent_timings":      agent_timings,
            }
            database.save_session(
                query=user_query,
                graph_data=graph_data,
                brief=brief_content,
                hypothesis=hypothesis_md,
                gaps=gaps_md,
                raw_files=raw_file_data,
                wiki_files=wiki_file_data,
                agent_logs=collected_logs,
                metrics=run_metrics,
            )
        except Exception as e:
            print(f"[DB] Failed to save session: {e}")
