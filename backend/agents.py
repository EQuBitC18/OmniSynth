import os
import json
import time
import asyncio
import networkx as nx

# Define the models
DEFAULT_MODEL = "gemini-3-flash"
REASONING_MODEL = "gemini-3-flash" # For Hypothesis and Synthesizer as per user specs

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

    async def run_pipeline(self, user_query: str, broadcast_callback=None, config: dict = None, session_id: int = None):
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
            await self._pipeline(user_query, log_step, database, collected_logs, config or {}, session_id, broadcast_callback)
        except Exception as e:
            err = str(e)
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                msg = "Gemini API rate limit reached (429). Wait a minute and try again."
            else:
                msg = f"Pipeline error: {err}"
            await log_step("orchestrator", "error", msg)
            return

    async def _pipeline(self, user_query, log_step, database, collected_logs, config, session_id=None, broadcast=None):
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
        num_gaps       = max(1, min(5,  int(config.get('num_gaps',       2))))
        num_hypotheses = max(1, min(3,  int(config.get('num_hypotheses', 1))))
        temperature    = max(0.0, min(1.0, float(config.get('temperature', 0.2))))
        model_tier     = config.get('model_tier',   'flash')
        wiki_detail    = config.get('wiki_detail',  'standard')

        model = {'flash': 'gemini-2.5-flash', 'pro': 'gemini-2.5-pro'}.get(model_tier, 'gemini-2.5-flash')

        # Convenience wrapper so every LLM call uses the user's temperature/model
        async def llm(prompt, sys=None, schema=None):
            return await self._call_llm(prompt, sys, schema, temperature=temperature, model=model)

        WIKI_PROMPTS = {
            'brief':    'Summarize this academic text as 3-5 concise bullet points covering the core concept and main finding.',
            'standard': 'Convert this academic text into a structured markdown wiki page. Extract the core concept, methodology, and key findings.',
            'detailed': 'Convert this academic text into a comprehensive markdown wiki with sections: Overview, Background, Methodology, Key Findings, Limitations, and Significance. Be thorough.',
        }
        # ── Session-isolated workspace setup ───────────────────────────────────
        # Always wipe the working directory first so sessions never bleed into each other.
        def _clear(folders):
            for folder in folders:
                for fname in os.listdir(folder):
                    try:
                        os.remove(os.path.join(folder, fname))
                    except Exception:
                        pass

        # Always regenerate derived outputs; raw/ is user-controlled (new session)
        # or DB-restored (continued session).
        _clear(['wikis', 'hypotheses', 'gaps'])

        if session_id:
            prev = database.get_session(session_id)
            if prev and prev.get('raw_files'):
                # Session has saved files — restore the exact snapshot into raw/
                _clear(['raw'])
                for item in prev['raw_files']:
                    with open(f"raw/{item['filename']}", 'w', encoding='utf-8') as f:
                        f.write(item['content'])
                for item in (prev.get('wiki_files') or []):
                    with open(f"wikis/{item['filename']}", 'w', encoding='utf-8') as f:
                        f.write(item['content'])
                for item in (prev.get('brief_files') or []):
                    with open(f"briefs/{item['filename']}", 'w', encoding='utf-8') as f:
                        f.write(item['content'])
            # Blank session (no saved files): keep raw/ as-is so uploads survive.
        # ───────────────────────────────────────────────────────────────────────

        # Orchestrator received query
        await log_step("orchestrator", "running",
                       f"Routing query: {user_query}" if user_query.strip() else "Processing uploaded documents…")
        await asyncio.sleep(0.3)

        # Collect papers — user provides them via upload or arXiv search
        raw_files = sorted([
            f"raw/{f}" for f in os.listdir("raw")
            if f.endswith('.txt') or f.endswith('.pdf')
        ])
        if not raw_files:
            await log_step("orchestrator", "error",
                           "No papers in the knowledge base. Upload your own papers or use the arXiv Search button first.")
            return

        # Convert any PDFs to txt in-place so the rest of the pipeline only sees txt
        import pypdf
        for pdf_path in [p for p in raw_files if p.endswith('.pdf')]:
            try:
                with open(pdf_path, 'rb') as f:
                    reader = pypdf.PdfReader(f)
                    text = "\n\n".join(pg.extract_text() or "" for pg in reader.pages[:60]).strip()
                txt_path = pdf_path[:-4] + '.txt'
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write(text)
                os.remove(pdf_path)
            except Exception as e:
                print(f"[PDF] Failed to convert {pdf_path}: {e}")
        raw_files = sorted([f"raw/{f}" for f in os.listdir("raw") if f.endswith('.txt')])

        await log_step("orchestrator", "success",
                       f"Starting pipeline with {len(raw_files)} paper(s) in the knowledge base.")

        # Ingestor Agent — only compile wikis for papers that don't already have one
        await log_step("ingestor", "running", "Compiling new abstracts into markdown wikis...")
        wiki_files = []
        new_wiki_count = 0
        skipped_wiki_count = 0
        for raw_file in raw_files:
            wiki_filename = raw_file.replace('raw/', 'wikis/').replace('.txt', '.md')
            if os.path.exists(wiki_filename):
                wiki_files.append(wiki_filename)
                skipped_wiki_count += 1
                continue
            with open(raw_file, "r", encoding='utf-8') as f:
                content = f.read()
            prompt = f"{WIKI_PROMPTS.get(wiki_detail, WIKI_PROMPTS['standard'])}\n\nText:\n{content}"
            wiki_content = await llm(prompt, "You are an expert academic summarizer.")
            with open(wiki_filename, "w", encoding='utf-8') as f:
                f.write(wiki_content)
            wiki_files.append(wiki_filename)
            new_wiki_count += 1
        ingestor_msg = f"Compiled {new_wiki_count} new wiki(s)"
        if skipped_wiki_count > 0:
            ingestor_msg += f" — {skipped_wiki_count} already in knowledge base"
        await log_step("ingestor", "success", ingestor_msg)

        # Synthesizer Agent — always reads the FULL accumulated wiki corpus
        all_wiki_paths = sorted([
            f"wikis/{f}" for f in os.listdir("wikis") if f.endswith(".md")
        ])
        await log_step("synthesizer", "running",
                       f"Building knowledge graph from {len(all_wiki_paths)} accumulated wiki(s)…")
        all_wikis = ""
        for w in all_wiki_paths:
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

        # Writer Agent — one summary brief per raw file, never overwrite existing
        await log_step("writer", "running", "Generating per-paper summary briefs…")
        new_brief_count = 0
        skipped_brief_count = 0

        for raw_file in raw_files:
            raw_stem = os.path.splitext(os.path.basename(raw_file))[0]
            brief_basename = f"brief_{raw_stem}.md"
            brief_path = f"briefs/{brief_basename}"

            if os.path.exists(brief_path):
                skipped_brief_count += 1
                continue

            with open(raw_file, "r", encoding="utf-8") as f:
                paper_content = f.read()

            brief_prompt = (
                "Write a clear, structured summary of this academic paper using markdown. "
                "Include the following sections: ## Overview, ## Methodology, ## Key Findings, ## Conclusions. "
                "Be concise but thorough. Do not invent information not present in the text.\n\n"
                f"Paper:\n{paper_content}"
            )
            brief_content = await llm(brief_prompt, "You are an expert scientific author.")

            with open(brief_path, "w", encoding="utf-8") as f:
                f.write(brief_content)

            if broadcast:
                await broadcast({"type": "brief_ready", "filename": brief_basename})
            new_brief_count += 1

        writer_msg = f"Generated {new_brief_count} new brief(s)"
        if skipped_brief_count:
            writer_msg += f" — {skipped_brief_count} already existed"
        await log_step("writer", "success", writer_msg)
        await log_step("orchestrator", "success", "Pipeline execution finished successfully.")

        # Persist session to SQLite — snapshot the full accumulated corpus
        try:
            raw_file_data = []
            for fname in sorted(os.listdir("raw")):
                with open(f"raw/{fname}", encoding="utf-8") as f:
                    raw_file_data.append({"filename": fname, "content": f.read()})

            wiki_file_data = []
            for fname in sorted(os.listdir("wikis")):
                with open(f"wikis/{fname}", encoding="utf-8") as f:
                    wiki_file_data.append({"filename": fname, "content": f.read()})

            brief_file_data = []
            for fname in sorted(os.listdir("briefs")):
                with open(f"briefs/{fname}", encoding="utf-8") as f:
                    brief_file_data.append({"filename": fname, "content": f.read()})

            run_metrics = {
                "total_time_seconds": round(time.time() - t_start, 1),
                "papers_processed":   len(raw_files),            # papers in this run's KB
                "papers_total":       len(raw_file_data),        # full accumulated KB
                "wikis_generated":    new_wiki_count,
                "graph_nodes":        len(graph_data.get("nodes", [])),
                "graph_links":        len(graph_data.get("links", [])),
                "steps_completed":    sum(1 for l in collected_logs if l["status"] == "success"),
                "agent_timings":      agent_timings,
            }
            session_kwargs = dict(
                query=user_query.strip() or "Uploaded documents",
                graph_data=graph_data,
                brief=brief_file_data[-1]['content'] if brief_file_data else '',
                hypothesis=hypothesis_md,
                gaps=gaps_md,
                raw_files=raw_file_data,
                wiki_files=wiki_file_data,
                brief_files=brief_file_data,  # all accumulated briefs
                agent_logs=collected_logs,
                metrics=run_metrics,
            )
            if session_id:
                database.update_session(session_id, **session_kwargs)
            else:
                database.save_session(**session_kwargs)
        except Exception as e:
            print(f"[DB] Failed to save session: {e}")
