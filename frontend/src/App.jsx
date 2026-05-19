import React, { useState, useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import ForceGraph2D from 'react-force-graph-2d';
import { Bot, FileText, Folder, CheckCircle2, CircleDashed, AlertCircle, MessageSquare, X, Search, Clock, ChevronRight, Send, Info, Upload, SlidersHorizontal, BarChart2, Play, Pencil } from 'lucide-react';
import './App.css';

const initialAgents = [
  { id: 'orchestrator', name: 'Orchestrator Agent', status: 'idle', logs: ['System ready.'] },
  { id: 'ingestor',     name: 'Ingestor Agent',     status: 'idle', logs: ['Standing by.'] },
  { id: 'synthesizer',  name: 'Synthesizer Agent',  status: 'idle', logs: ['Ready to compile.'] },
  { id: 'lint',         name: 'Lint Agent',         status: 'idle', logs: ['Gap detection active.'] },
  { id: 'hypothesis',   name: 'Hypothesis Agent',   status: 'idle', logs: ['Awaiting gaps.'] },
  { id: 'writer',       name: 'Writer Agent',       status: 'idle', logs: ['Ready to draft.'] }
];

// ── Group metadata (matches prompt: group 1=core, 2=method, 3=finding) ────
const GROUP_META = {
  0: { label: 'Uncategorized', color: '#3b82f6' },
  1: { label: 'Core Topic',   color: '#8b5cf6' },
  2: { label: 'Method',       color: '#10b981' },
  3: { label: 'Finding',      color: '#ef4444' },
  4: { label: 'Factor',       color: '#f59e0b' },
  5: { label: 'Related',      color: '#ec4899' },
};
const LEGEND_GROUPS = [1, 2, 3];

const AGENT_DESCRIPTIONS = {
  orchestrator: 'Routes and coordinates the full pipeline. Receives the user query, delegates work to each agent in sequence, and signals completion.',
  ingestor:     'Transforms raw abstracts into structured markdown wikis by extracting core concepts, methodology, and key findings.',
  synthesizer:  'Builds the knowledge graph. Identifies key concepts and semantic relationships across all wikis to produce the node-link structure.',
  lint:         'Detects research gaps. Analyzes graph topology to identify missing links, under-explored areas, and blind spots in the literature.',
  hypothesis:   'Generates novel scientific hypotheses grounded in the identified research gaps, aiming for high impact and testability.',
  writer:       'Drafts the final IMRaD-style research brief, synthesising all compiled wikis, gaps, and the novel hypothesis into one document.',
};

// ── Markdown renderer ──────────────────────────────────────────────────────
function renderLatex(expr, display, key) {
  try {
    const html = katex.renderToString(expr, { displayMode: display, throwOnError: false });
    return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span key={key}>{display ? `$$${expr}$$` : `$${expr}$`}</span>;
  }
}

function renderInline(text, key) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+?\*\*|\*[^*]+?\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$'))
      return renderLatex(part.slice(2, -2), true, `${key}-dm${i}`);
    if (part.startsWith('$') && part.endsWith('$'))
      return renderLatex(part.slice(1, -1), false, `${key}-im${i}`);
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={`${key}-s${i}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={`${key}-e${i}`}>{part.slice(1, -1)}</em>;
    return part || null;
  });
}

function MarkdownRenderer({ content }) {
  if (!content) return null;
  const elements = [];
  let listItems = [];

  const flushList = (k) => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${k}`}>{listItems}</ul>);
      listItems = [];
    }
  };

  content.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    const listMatch = line.match(/^[-*] (.+)/);
    if (!listMatch) flushList(i);

    if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
      elements.push(<div key={i} className="math-block">{renderLatex(trimmed.slice(2, -2), true, i)}</div>);
    } else if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length > 2 && !trimmed.slice(1, -1).includes('$')) {
      elements.push(<div key={i} className="math-block">{renderLatex(trimmed.slice(1, -1), true, i)}</div>);
    } else if (listMatch)               listItems.push(<li key={i}>{renderInline(listMatch[1], i)}</li>);
    else if (line.startsWith('#### ')) elements.push(<h4 key={i}>{renderInline(line.slice(5), i)}</h4>);
    else if (line.startsWith('### '))  elements.push(<h3 key={i}>{renderInline(line.slice(4), i)}</h3>);
    else if (line.startsWith('## '))   elements.push(<h2 key={i}>{renderInline(line.slice(3), i)}</h2>);
    else if (line.startsWith('# '))    elements.push(<h1 key={i}>{renderInline(line.slice(2), i)}</h1>);
    else if (/^---+$/.test(trimmed))   elements.push(<hr key={i} />);
    else if (trimmed === '')           elements.push(<div key={i} className="md-spacer" />);
    else                               elements.push(<p  key={i}>{renderInline(line, i)}</p>);
  });
  flushList('end');

  return <div className="markdown-body">{elements}</div>;
}
// ──────────────────────────────────────────────────────────────────────────

function App() {
  const [agents, setAgents]           = useState(initialAgents);
  const [activeAgent, setActiveAgent] = useState(initialAgents[0]);
  const [globalLogs, setGlobalLogs]   = useState([
    { type: 'info', text: '[System] OmniSynth Multi-Agent Pipeline initialized.' },
    { type: 'info', text: '[System] Knowledge Graph Engine loaded.' }
  ]);
  const [graphData, setGraphData]         = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode]   = useState(null);
  const [query, setQuery]                 = useState('');
  const [isProcessing, setIsProcessing]   = useState(false);
  const [files, setFiles]                 = useState({ raw: [], wikis: [], briefs: [], hypotheses: [], gaps: [] });
  const [selectedBrief, setSelectedBrief] = useState(null);
  const [sessions, setSessions]           = useState([]);
  const [viewingSession, setViewingSession] = useState(null);
  const [sessionData, setSessionData]     = useState(null);
  const [pipelineHasRun, setPipelineHasRun] = useState(false);
  const [showGraphInfo, setShowGraphInfo] = useState(false);
  const [chatOpen, setChatOpen]       = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello! Ask me anything about the compiled knowledge base.' }
  ]);
  const [chatInput, setChatInput]     = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const [nodeDescription, setNodeDescription] = useState({ id: null, text: '', loading: false });
  const [agentDetailOpen, setAgentDetailOpen] = useState(false);
  const [editMode, setEditMode]               = useState(false);
  const [editContent, setEditContent]         = useState('');
  const [deleteConfirm, setDeleteConfirm]     = useState(null); // { id, query }
  const [deleteFileConfirm, setDeleteFileConfirm] = useState(null); // { folder, filename }
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [uploadBusy, setUploadBusy]             = useState(false);
  const [showArxivSearch, setShowArxivSearch]   = useState(false);
  const [arxivQuery,  setArxivQuery]            = useState('');
  const [arxivCount,  setArxivCount]            = useState(3);
  const [arxivSort,   setArxivSort]             = useState('relevance');
  const [arxivBusy,   setArxivBusy]             = useState(false);
  const [arxivResult, setArxivResult]           = useState(null); // { files, error }
  const [newFileName, setNewFileName]         = useState('');
  const [newFileContent, setNewFileContent]   = useState('');
  const [selectedFile, setSelectedFile]       = useState(null);
  const [showSettings, setShowSettings]       = useState(false);
  const [showMetrics,  setShowMetrics]        = useState(false);
  const [sysMetrics, setSysMetrics]           = useState(null);
  const [settings, setSettings]               = useState({
    papers_count:   3,
    sort_order:     'relevance',
    num_gaps:       2,
    num_hypotheses: 1,
    temperature:    0.2,
    model_tier:     'flash',
    wiki_detail:    'standard',
    brief_format:   'summary',
  });

  const [showPipelineDone, setShowPipelineDone]     = useState(false);
  const [renamingFile, setRenamingFile]             = useState(null);
  const [renameFileInput, setRenameFileInput]       = useState('');
  const [renamingSession, setRenamingSession]       = useState(null);
  const [renameSessionInput, setRenameSessionInput] = useState('');

  const graphRef           = useRef();
  const wsRef              = useRef(null);
  const currentGraphRef    = useRef({ nodes: [], links: [] });
  const chatEndRef         = useRef(null);
  const logsEndRef         = useRef(null);
  const nodeDescCache      = useRef({});


  // Only show graph/file content when a pipeline has run, a session is loaded, or raw files exist
  const hasContent = pipelineHasRun || !!viewingSession || files.raw.length > 0;

  // Derive display lists: session data (with content) or filesystem filenames.
  // For blank/new sessions (no saved files yet) fall back to the filesystem listing.
  const displayRaw    = (sessionData?.raw_files?.length > 0)
    ? sessionData.raw_files
    : files.raw.map(f => ({ filename: f, content: null }));
  const displayWikis  = sessionData?.wiki_files  ?? files.wikis.map(f => ({ filename: f, content: null }));
  const displayBriefs = sessionData
    ? (sessionData.brief_files?.length
        ? sessionData.brief_files
        : sessionData.brief
          ? [{ filename: 'brief.md', content: sessionData.brief }]
          : [])
    : files.briefs.map(f => ({ filename: f, content: null }));
  const displayHypotheses = sessionData
    ? (sessionData.hypothesis ? [{ filename: 'hypothesis.md', content: sessionData.hypothesis }] : [])
    : files.hypotheses.map(f => ({ filename: f, content: null }));
  const displayGaps = sessionData
    ? (sessionData.gaps ? [{ filename: 'gaps.md', content: sessionData.gaps }] : [])
    : files.gaps.map(f => ({ filename: f, content: null }));

  // Auto-scroll chat and system logs on new messages
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [globalLogs]);

  const fetchNodeDescription = async (node) => {
    if (nodeDescCache.current[node.id]) {
      setNodeDescription({ id: node.id, text: nodeDescCache.current[node.id], loading: false });
      return;
    }
    setNodeDescription({ id: node.id, text: '', loading: true });
    try {
      const meta = GROUP_META[node.group % Object.keys(GROUP_META).length] ?? GROUP_META[0];
      const res = await fetch('/api/node-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_name: node.name, node_type: meta.label })
      });
      if (res.ok) {
        const data = await res.json();
        nodeDescCache.current[node.id] = data.description;
        setNodeDescription({ id: node.id, text: data.description, loading: false });
      }
    } catch {
      setNodeDescription({ id: node.id, text: '', loading: false });
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          session_id: viewingSession?.id ?? null
        })
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      } else {
        throw new Error('Request failed');
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Fetchers ────────────────────────────────────────────────────────────
  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) setFiles(await res.json());
    } catch (err) { console.error('fetchFiles', err); }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) setSessions(await res.json());
    } catch (err) { console.error('fetchSessions', err); }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/metrics');
      if (res.ok) setSysMetrics(await res.json());
    } catch (err) { console.error('fetchMetrics', err); }
  };

  const fmtTime = (s) => {
    if (!s) return '—';
    const m = Math.floor(s / 60), sec = Math.round(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // Maps API route prefix → actual filesystem folder name
  const FS_FOLDER = { raw: 'raw', wiki: 'wikis', brief: 'briefs', hypothesis: 'hypotheses', gaps: 'gaps' };

  const fetchBrief = async (filename) => {
    try {
      const res = await fetch(`/api/brief/${filename}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBrief({ filename, content: data.content, folder: 'briefs' });
        setEditMode(false);
      }
    } catch (err) { console.error('fetchBrief', err); }
  };

  // Open any file: use in-memory content if available, otherwise hit the API
  const handleFileOpen = async (fileObj, apiFolder) => {
    const fsFolder = FS_FOLDER[apiFolder] ?? apiFolder;
    setEditMode(false);
    if (fileObj.content != null) {
      setSelectedBrief({ filename: fileObj.filename, content: fileObj.content, folder: fsFolder });
      return;
    }
    try {
      const res = await fetch(`/api/${apiFolder}/${fileObj.filename}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBrief({ filename: fileObj.filename, content: data.content, folder: fsFolder });
      }
    } catch (err) { console.error('handleFileOpen', err); }
  };

  const saveFile = async () => {
    if (!selectedBrief?.folder) return;
    try {
      const res = await fetch(`/api/file/${selectedBrief.folder}/${selectedBrief.filename}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent })
      });
      if (res.ok) {
        setSelectedBrief(prev => ({ ...prev, content: editContent }));
        setEditMode(false);
      }
    } catch (err) { console.error('saveFile', err); }
  };

  const deleteFile = async () => {
    if (!deleteFileConfirm) return;
    const { folder, filename } = deleteFileConfirm;
    try {
      const res = await fetch(`/api/file/${folder}/${filename}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedBrief?.filename === filename) { setSelectedBrief(null); setEditMode(false); }
        fetchFiles();
      }
    } catch (err) { console.error('deleteFile', err); }
    finally { setDeleteFileConfirm(null); }
  };

  const confirmDeleteSession = (id, query, e) => {
    e.stopPropagation();
    setDeleteConfirm({ id, query });
  };

  const deleteSession = async () => {
    if (!deleteConfirm) return;
    try {
      await fetch(`/api/sessions/${deleteConfirm.id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== deleteConfirm.id));
      if (viewingSession?.id === deleteConfirm.id) exitHistoryMode();
    } catch (err) { console.error('deleteSession', err); } finally {
      setDeleteConfirm(null);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    setNewFileName(file.name);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    if (isPdf) {
      setNewFileContent('');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => setNewFileContent(evt.target.result ?? '');
    reader.readAsText(file, 'utf-8');
  };

  const resetNewFileModal = () => {
    setShowNewFileModal(false);
    setSelectedFile(null);
    setNewFileName('');
    setNewFileContent('');
    setUploadBusy(false);
  };

  const runArxivSearch = async () => {
    if (!arxivQuery.trim() || arxivBusy) return;
    setArxivBusy(true);
    setArxivResult(null);
    try {
      const res = await fetch('/api/arxiv-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: arxivQuery, count: arxivCount, sort_order: arxivSort })
      });
      if (res.ok) {
        const data = await res.json();
        setArxivResult({ files: data.files, error: null });
        fetchFiles();
      } else {
        const err = await res.json();
        setArxivResult({ files: [], error: err.detail || 'Search failed' });
      }
    } catch (err) {
      setArxivResult({ files: [], error: err.message });
    } finally {
      setArxivBusy(false);
    }
  };

  const createRawFile = async () => {
    if (!selectedFile || uploadBusy) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    setUploadBusy(true);
    try {
      const res = await fetch('/api/upload/raw', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) { resetNewFileModal(); window.location.reload(); }
    } catch (err) { console.error('createRawFile', err); setUploadBusy(false); }
  };

  // ── Session management ───────────────────────────────────────────────────
  const loadSession = async (session) => {
    try {
      const res = await fetch(`/api/sessions/${session.id}`);
      if (!res.ok) return;
      const data = await res.json();
      localStorage.setItem('omnisynth_session', String(session.id)); // sync — survives pipeline reload
      setGraphData(data.graph_data || { nodes: [], links: [] });
      currentGraphRef.current = data.graph_data || { nodes: [], links: [] };
      setSessionData(data);
      setSelectedBrief({ filename: session.query, content: data.brief || '', folder: null });
      setViewingSession(session);
      setEditMode(false);
    } catch (err) { console.error('loadSession', err); }
  };

  const exitHistoryMode = () => {
    localStorage.removeItem('omnisynth_session');
    setGraphData(currentGraphRef.current);
    setSelectedBrief(null);
    setViewingSession(null);
    setSessionData(null);
    setEditMode(false);
  };

  const createNewSession = async () => {
    try {
      const res = await fetch('/api/sessions/new', { method: 'POST' });
      if (!res.ok) return;
      const session = await res.json();
      localStorage.setItem('omnisynth_session', String(session.id)); // sync — survives upload reload
      setSessions(prev => [session, ...prev]);
      setViewingSession(session);
      setSessionData({ raw_files: [], wiki_files: [], brief_files: [], brief: null, hypothesis: null, gaps: null, graph_data: { nodes: [], links: [] }, agent_logs: [] });
      setGraphData({ nodes: [], links: [] });
      setSelectedBrief(null);
      setEditMode(false);
    } catch (err) { console.error('createNewSession', err); }
  };

  // Persist active session across page reloads (e.g. after file upload)
  useEffect(() => {
    if (viewingSession?.id) {
      localStorage.setItem('omnisynth_session', String(viewingSession.id));
    } else {
      localStorage.removeItem('omnisynth_session');
    }
  }, [viewingSession?.id]);

  // ── WebSocket + mount ───────────────────────────────────────────────────
  useEffect(() => {
    fetchFiles();
    fetchSessions();
    fetchMetrics();

    sessionStorage.removeItem('pipeline_running'); // clear any stuck flag from old code

    // Restore the previously active session after a page reload
    const savedId = localStorage.getItem('omnisynth_session');
    if (savedId) {
      fetch(`/api/sessions/${savedId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) { localStorage.removeItem('omnisynth_session'); return; }
          const session = { id: data.id, query: data.query, created_at: data.created_at };
          setViewingSession(session);
          setSessionData(data);
          setGraphData(data.graph_data || { nodes: [], links: [] });
          currentGraphRef.current = data.graph_data || { nodes: [], links: [] };
          if (data.brief_files?.length) {
            const last = data.brief_files[data.brief_files.length - 1];
            setSelectedBrief({ filename: last.filename, content: last.content, folder: 'briefs' });
          }
        })
        .catch(() => localStorage.removeItem('omnisynth_session'));
    }

    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${location.host}/ws/logs`);
    wsRef.current = ws;

    ws.onopen = () =>
      setGlobalLogs(prev => [...prev, { type: 'success', text: '[System] Connected to OmniSynth backend WebSocket.' }]);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'brief_ready') {
          fetchBrief(data.filename);
        } else if (data.type === 'info') {
          setGlobalLogs(prev => [...prev, { type: 'info', text: `[System] ${data.text}` }]);
        } else if (data.type === 'status') {
          updateAgentStatus(data.agent, data.status, data.log);
          if (data.graph_data) {
            setGraphData(data.graph_data);
            currentGraphRef.current = data.graph_data;
          }
          if (data.status === 'error') {
            setIsProcessing(false);
          }
          if (data.agent === 'orchestrator' && data.status === 'success' && data.log.includes('Pipeline execution finished')) {
            setIsProcessing(false);
            setShowPipelineDone(true);
          }
        }
      } catch (err) { console.error('ws.onmessage', err); }
    };

    ws.onerror = () =>
      setGlobalLogs(prev => [...prev, { type: 'error', text: '[System] WebSocket connection error.' }]);

    ws.onclose = () =>
      setGlobalLogs(prev => [...prev, { type: 'warning', text: '[System] WebSocket connection closed.' }]);

    return () => { if (ws.readyState < 2) ws.close(); }; // close even if still CONNECTING (readyState 0)
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────
  const runPipeline = async (queryText) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setAgents(prev => prev.map(a => ({ ...a, status: 'idle' })));
    setGlobalLogs(prev => [...prev, { type: 'info', text: `[User] Triggered query: "${queryText}"` }]);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          // viewingSession may not yet be restored in React state after a reload —
          // fall back to localStorage which is always written synchronously.
          session_id: viewingSession?.id ?? (localStorage.getItem('omnisynth_session') ? Number(localStorage.getItem('omnisynth_session')) : null),
          ...settings
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setGlobalLogs(prev => [...prev, { type: 'error', text: `[System] API Request failed: ${err.message}` }]);
      setIsProcessing(false);
    }
  };

  const renameFile = async (folder, oldFilename, newFilename) => {
    setRenamingFile(null);
    if (!newFilename.trim() || newFilename.trim() === oldFilename) return;
    try {
      const res = await fetch(`/api/file/${folder}/${encodeURIComponent(oldFilename)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_filename: newFilename.trim() })
      });
      if (res.ok) {
        fetchFiles();
        if (selectedBrief?.filename === oldFilename)
          setSelectedBrief(prev => ({ ...prev, filename: newFilename.trim() }));
      }
    } catch (err) { console.error('renameFile', err); }
  };

  const renameSession = async (sessionId, newName) => {
    setRenamingSession(null);
    if (!newName.trim()) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      if (res.ok) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, query: newName.trim() } : s));
        if (viewingSession?.id === sessionId)
          setViewingSession(prev => ({ ...prev, query: newName.trim() }));
      }
    } catch (err) { console.error('renameSession', err); }
  };

  const handleQuery = async (e) => {
    if (e.key !== 'Enter') return;
    runPipeline(query);
  };

  const updateAgentStatus = (id, status, log) => {
    setAgents(prev => prev.map(a =>
      a.id === id ? { ...a, status, logs: [...a.logs, log] } : a
    ));
    setGlobalLogs(prev => [...prev, {
      type: status === 'error' ? 'error' : 'info',
      text: `[${id.toUpperCase()}] ${log}`
    }]);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const StatusIcon = ({ status }) => {
    if (status === 'running') return <CircleDashed className="text-blue-400 animate-spin" size={16} />;
    if (status === 'success') return <CheckCircle2 className="text-emerald-400" size={16} />;
    if (status === 'error')   return <AlertCircle className="text-red-400" size={16} />;
    return <span className="status-dot status-idle" />;
  };

  const getNodeColor = (group) =>
    GROUP_META[group % Object.keys(GROUP_META).length]?.color ?? '#3b82f6';

  const getGroupMeta = (group) =>
    GROUP_META[group % Object.keys(GROUP_META).length] ?? GROUP_META[0];

  const getConnectedNodes = (node) =>
    graphData.links.reduce((acc, l) => {
      const sId = l.source?.id ?? l.source;
      const tId = l.target?.id ?? l.target;
      if (sId === node.id) { const n = graphData.nodes.find(n => n.id === tId);   if (n) acc.push(n); }
      if (tId === node.id) { const n = graphData.nodes.find(n => n.id === sId);   if (n) acc.push(n); }
      return acc;
    }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container text-white">

      <div className="app-main-row">
      {/* ── Left Sidebar ── */}
      <div className="sidebar-left glass">
        <div className="header">
          <h1><Bot size={20} /> OmniSynth Agents</h1>
        </div>
        <div className="run-pipeline-row">
          <button
            className={`run-pipeline-btn ${isProcessing ? 'run-pipeline-btn-busy' : ''}`}
            onClick={() => runPipeline(query)}
            disabled={isProcessing}
            title={query.trim() ? `Run: "${query}"` : 'Run pipeline on uploaded documents'}
          >
            {isProcessing
              ? <><CircleDashed size={14} className="animate-spin" /> Running…</>
              : <><Play size={14} /> Run Pipeline</>}
          </button>
        </div>

        <div className="agent-list">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`agent-card ${activeAgent.id === agent.id ? 'active' : ''}`}
              onClick={() => { setActiveAgent(agents.find(a => a.id === agent.id)); setAgentDetailOpen(true); }}
            >
              <div className="agent-header">
                <span className="agent-name">{agent.name}</span>
                <StatusIcon status={agent.status} />
              </div>
              <div className="agent-status-text">
                {agent.logs[agent.logs.length - 1]}
              </div>
            </div>
          ))}
        </div>


        <div className="global-logs border-t border-white/10">
          <div className="logs-label">
            {viewingSession ? `Session Logs · ${viewingSession.query.slice(0, 28)}…` : 'System Logs'}
          </div>
          {viewingSession && sessionData?.agent_logs
            ? sessionData.agent_logs.map((l, i) => (
                <div key={i} className={`log-entry log-${l.status === 'error' ? 'error' : 'info'}`}>
                  [{l.agent.toUpperCase()}] {l.log}
                </div>
              ))
            : globalLogs.map((log, i) => (
                <div key={i} className={`log-entry log-${log.type}`}>{log.text}</div>
              ))
          }
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* ── Agent Detail Popup ── */}
      {agentDetailOpen && activeAgent && (
        <div className="agent-popup glass">
          <div className="agent-popup-header">
            <StatusIcon status={activeAgent.status} />
            <span className="agent-popup-name">{activeAgent.name}</span>
            <button className="close-btn" style={{ marginLeft: 'auto' }} onClick={() => setAgentDetailOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <p className="agent-popup-description">{AGENT_DESCRIPTIONS[activeAgent.id]}</p>
          <div className="agent-popup-logs">
            <div className="logs-label">
              Agent Logs {viewingSession ? '· historical' : ''}
            </div>
            {(viewingSession && sessionData?.agent_logs
              ? sessionData.agent_logs.filter(l => l.agent === activeAgent.id).map(l => l.log)
              : agents.find(a => a.id === activeAgent.id)?.logs ?? []
            ).map((log, i) => (
              <div key={i} className="log-entry log-info">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="main-content">

        {/* Settings Panel */}
        {showSettings && (
          <div className="settings-panel glass">
            <div className="settings-grid">

              <div className="settings-item">
                <label>Papers to fetch <span className="settings-val">{settings.papers_count}</span></label>
                <input type="range" min="1" max="10" value={settings.papers_count}
                  onChange={e => setSettings(s => ({ ...s, papers_count: +e.target.value }))} />
              </div>

              <div className="settings-item">
                <label>Temperature <span className="settings-val">{settings.temperature.toFixed(1)}</span></label>
                <input type="range" min="0" max="1" step="0.1" value={settings.temperature}
                  onChange={e => setSettings(s => ({ ...s, temperature: +e.target.value }))} />
              </div>

              <div className="settings-item">
                <label>Sort order</label>
                <select value={settings.sort_order}
                  onChange={e => setSettings(s => ({ ...s, sort_order: e.target.value }))}>
                  <option value="relevance">Relevance</option>
                  <option value="recent">Most Recent</option>
                </select>
              </div>

              <div className="settings-item">
                <label>Model</label>
                <div className="settings-radio-group">
                  {[['flash','Flash — fast'], ['pro','Pro — powerful']].map(([val, label]) => (
                    <label key={val} className={`settings-radio-btn ${settings.model_tier === val ? 'active' : ''}`}>
                      <input type="radio" value={val} checked={settings.model_tier === val}
                        onChange={() => setSettings(s => ({ ...s, model_tier: val }))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="settings-item">
                <label>Research gaps <span className="settings-val">{settings.num_gaps}</span></label>
                <input type="range" min="1" max="5" value={settings.num_gaps}
                  onChange={e => setSettings(s => ({ ...s, num_gaps: +e.target.value }))} />
              </div>

              <div className="settings-item">
                <label>Hypotheses <span className="settings-val">{settings.num_hypotheses}</span></label>
                <input type="range" min="1" max="3" value={settings.num_hypotheses}
                  onChange={e => setSettings(s => ({ ...s, num_hypotheses: +e.target.value }))} />
              </div>

              <div className="settings-item">
                <label>Wiki detail</label>
                <select value={settings.wiki_detail}
                  onChange={e => setSettings(s => ({ ...s, wiki_detail: e.target.value }))}>
                  <option value="brief">Brief</option>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>

              <div className="settings-item">
                <label>Brief format</label>
                <select value={settings.brief_format}
                  onChange={e => setSettings(s => ({ ...s, brief_format: e.target.value }))}>
                  <option value="summary">Knowledge Summary</option>
                  <option value="executive">Executive Summary</option>
                  <option value="bullets">Bullet Points</option>
                </select>
              </div>

            </div>
          </div>
        )}

        <div className="panes-container">
          {/* Graph Pane */}
          <div className="graph-pane">
            {hasContent ? (
              <>
                <ForceGraph2D
                  ref={graphRef}
                  graphData={graphData}
                  nodeLabel=""
                  nodeColor={node => getNodeColor(node.group)}
                  nodeRelSize={6}
                  linkColor={() => 'rgba(255,255,255,0.2)'}
                  backgroundColor="transparent"
                  onNodeClick={node => { setSelectedNode(node); fetchNodeDescription(node); }}
                  cooldownTicks={100}
                  onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
                  nodeCanvasObject={(node, ctx, globalScale) => {
                    const label = node.name || '';
                    const fontSize = 12 / globalScale;
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const textWidth = ctx.measureText(label).width;
                    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2 - 8, ...bckgDimensions);
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.fillText(label, node.x, node.y - 8);
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI, false);
                    ctx.fillStyle = getNodeColor(node.group);
                    ctx.fill();
                  }}
                />
                {/* Node info panel — top-left */}
                {selectedNode && (() => {
                  const meta      = getGroupMeta(selectedNode.group);
                  const connected = getConnectedNodes(selectedNode);
                  return (
                    <div className="node-info-panel glass">
                      <div className="node-info-header">
                        <span className="node-type-badge" style={{ background: meta.color + '22', color: meta.color, borderColor: meta.color + '55' }}>
                          <span className="node-type-dot" style={{ background: meta.color }} />
                          {meta.label}
                        </span>
                        <button className="close-btn" onClick={() => setSelectedNode(null)}><X size={14} /></button>
                      </div>
                      <div className="node-info-name">{selectedNode.name}</div>
                      <div className="node-info-stats">
                        <span>{connected.length} connection{connected.length !== 1 ? 's' : ''}</span>
                      </div>

                      {/* AI-generated description */}
                      <div className="node-description-box">
                        {nodeDescription.id === selectedNode.id && nodeDescription.loading && (
                          <span className="node-desc-loading">Generating description…</span>
                        )}
                        {nodeDescription.id === selectedNode.id && !nodeDescription.loading && nodeDescription.text && (
                          <p className="node-desc-text">{nodeDescription.text}</p>
                        )}
                      </div>

                      {connected.length > 0 && (
                        <div className="node-connected-list">
                          {connected.map((n, i) => (
                            <div key={i} className="node-connected-item" onClick={() => setSelectedNode(n)}>
                              <span className="node-connected-dot" style={{ background: getNodeColor(n.group) }} />
                              <span className="node-connected-name">{n.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Info button — top-right */}
                <button
                  className={`graph-info-btn glass ${showGraphInfo ? 'graph-info-btn-active' : ''}`}
                  onClick={() => setShowGraphInfo(o => !o)}
                  title="How to read this graph"
                >
                  <Info size={15} />
                </button>

                {/* Info panel */}
                {showGraphInfo && (
                  <div className="graph-info-panel glass">
                    <div className="graph-info-title">
                      <Info size={13} /> How to read this graph
                      <button className="close-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowGraphInfo(false)}><X size={13} /></button>
                    </div>
                    <div className="graph-info-body">
                      <p><strong>Nodes</strong> are key concepts extracted from the literature by the Synthesizer Agent.</p>
                      <p><strong>Links</strong> represent semantic or causal relationships between concepts.</p>
                      <p><strong>Clusters</strong> naturally form around related topics — distant clusters indicate separate research threads.</p>
                      <p>Click any node to inspect it and navigate its connections.</p>
                    </div>
                  </div>
                )}

                {/* Legend — bottom-left */}
                <div className="graph-legend glass">
                  {LEGEND_GROUPS.map(g => {
                    const m = GROUP_META[g];
                    return (
                      <div key={g} className="legend-item">
                        <span className="legend-dot" style={{ background: m.color }} />
                        <span className="legend-label">{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="graph-placeholder">
                <Search size={44} className="text-slate-700 mb-3" />
                <p>Run a query to generate a knowledge graph</p>
              </div>
            )}

            {/* Chat Panel */}
            {chatOpen && (
              <div className="chat-panel glass">
                <div className="chat-header">
                  <MessageSquare size={15} className="text-blue-400" />
                  <span className="chat-title">Knowledge Base Chat</span>
                  {viewingSession && (
                    <span className="chat-session-badge">Historical session</span>
                  )}
                  <button className="close-btn" style={{ marginLeft: 'auto' }} onClick={() => setChatOpen(false)}>
                    <X size={15} />
                  </button>
                </div>

                <div className="chat-messages">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`chat-message chat-message-${msg.role}`}>
                      {msg.role === 'assistant'
                        ? <MarkdownRenderer content={msg.content} />
                        : msg.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="chat-loading">
                      <span className="chat-typing-dot" /><span className="chat-typing-dot" /><span className="chat-typing-dot" />
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="chat-input-area">
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="Ask about the knowledge base…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                    disabled={chatLoading}
                  />
                  <button
                    className="chat-send-btn"
                    onClick={sendChatMessage}
                    disabled={chatLoading || !chatInput.trim()}
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            )}

            <div className="fab-container">
              <button
                className={`fab-button ${chatOpen ? 'fab-active' : ''}`}
                title="Chat with Compiled Knowledge Base"
                onClick={() => setChatOpen(o => !o)}
              >
                {chatOpen ? <X size={22} /> : <MessageSquare size={22} />}
              </button>
            </div>
          </div>

          {/* Brief / Document Pane */}
          <div className="brief-pane">
            {selectedBrief ? (
              <>
                <div className="brief-header glass">
                  <FileText size={15} className={viewingSession ? 'text-amber-400 flex-shrink-0' : 'text-emerald-400 flex-shrink-0'} />
                  <span className="brief-title">{selectedBrief.filename}</span>
                  {viewingSession && (
                    <button className="session-back-btn" onClick={exitHistoryMode}>← Current</button>
                  )}
                  {!editMode && selectedBrief.folder && (
                    <button className="file-action-btn" onClick={() => { setEditMode(true); setEditContent(selectedBrief.content); }}>
                      Edit
                    </button>
                  )}
                  {editMode && (
                    <>
                      <button className="file-action-btn file-save-btn" onClick={saveFile}>Save</button>
                      <button className="file-action-btn" onClick={() => setEditMode(false)}>Cancel</button>
                    </>
                  )}
                  <button className="close-btn brief-close" onClick={() => { setSelectedBrief(null); setEditMode(false); if (viewingSession) exitHistoryMode(); }}>
                    <X size={15} />
                  </button>
                </div>
                <div className="brief-content">
                  {editMode ? (
                    <textarea
                      className="edit-textarea"
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                    />
                  ) : (
                    <MarkdownRenderer content={selectedBrief.content} />
                  )}
                </div>
              </>
            ) : (
              <div className="brief-placeholder">
                <FileText size={36} className="text-slate-600 mb-3" />
                <p>{hasContent ? 'Select a document from the Knowledge Base' : 'Run a query to get started'}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right Sidebar ── */}
      <div className="sidebar-right glass">
        <div className="header">
          <h1><Folder size={20} /> Knowledge Base</h1>
        </div>

        <div className="file-explorer">
          {/* Helper: file row with optional delete button */}
          {(() => {
            const FileRow = ({ file, color, onOpen, fsFolder }) => {
              const isRenaming = renamingFile?.folder === fsFolder && renamingFile?.filename === file.filename;
              return (
                <div
                  className={`file-item file-item-clickable ${selectedBrief?.filename === file.filename && !viewingSession ? 'file-item-active' : ''}`}
                  onClick={isRenaming ? undefined : onOpen}
                >
                  <FileText size={13} className={`${color} flex-shrink-0`} />
                  {isRenaming ? (
                    <input
                      className="rename-input"
                      autoFocus
                      value={renameFileInput}
                      onChange={e => setRenameFileInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') renameFile(fsFolder, file.filename, renameFileInput);
                        if (e.key === 'Escape') setRenamingFile(null);
                      }}
                      onBlur={() => renameFile(fsFolder, file.filename, renameFileInput)}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="file-item-name truncate">{file.filename}</span>
                  )}
                  {!sessionData && !isRenaming && (
                    <>
                      <button
                        className="file-delete-btn"
                        title="Rename file"
                        onClick={e => { e.stopPropagation(); setRenamingFile({ folder: fsFolder, filename: file.filename }); setRenameFileInput(file.filename); }}
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        className="file-delete-btn"
                        title="Delete file"
                        onClick={e => { e.stopPropagation(); setDeleteFileConfirm({ folder: fsFolder, filename: file.filename }); }}
                      >
                        <X size={10} />
                      </button>
                    </>
                  )}
                </div>
              );
            };

            return (
              <>
                {/* RAW */}
                <div className="folder">
                  <div className="folder-title">
                    <Folder size={14} /> RAW/
                    <div className="folder-actions">
                      {/* TODO: re-enable arXiv search button after demo review
                      <button className="add-file-btn" onClick={() => { setShowArxivSearch(true); setArxivResult(null); }} title="Search arXiv">
                        <Search size={11} />
                      </button>
                      */}
                      <button className="add-file-btn" onClick={() => setShowNewFileModal(true)} title="Upload paper">+</button>
                    </div>
                  </div>
                  {hasContent && displayRaw.map((file, i) => (
                    <FileRow key={i} file={file} color="text-blue-400" fsFolder="raw"
                      onOpen={() => handleFileOpen(file, 'raw')} />
                  ))}
                </div>

                {/* WIKIS */}
                <div className="folder">
                  <div className="folder-title"><Folder size={14} /> WIKIS/</div>
                  {hasContent && displayWikis.map((file, i) => (
                    <FileRow key={i} file={file} color="text-purple-400" fsFolder="wikis"
                      onOpen={() => handleFileOpen(file, 'wiki')} />
                  ))}
                </div>

                {/* BRIEFS */}
                <div className="folder">
                  <div className="folder-title"><Folder size={14} /> BRIEFS/</div>
                  {hasContent && displayBriefs.map((file, i) => (
                    <FileRow key={i} file={file} color="text-emerald-400" fsFolder="briefs"
                      onOpen={() => handleFileOpen(file, 'brief')} />
                  ))}
                </div>

                {/* HYPOTHESES */}
                <div className="folder">
                  <div className="folder-title"><Folder size={14} /> HYPOTHESES/</div>
                  {hasContent && displayHypotheses.map((file, i) => (
                    <FileRow key={i} file={file} color="text-amber-400" fsFolder="hypotheses"
                      onOpen={() => handleFileOpen(file, 'hypothesis')} />
                  ))}
                </div>

                {/* GAPS */}
                <div className="folder">
                  <div className="folder-title"><Folder size={14} /> GAPS/</div>
                  {hasContent && displayGaps.map((file, i) => (
                    <FileRow key={i} file={file} color="text-red-400" fsFolder="gaps"
                      onOpen={() => handleFileOpen(file, 'gaps')} />
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* History */}
        <div className="history-section">
          <div className="history-header">
            <Clock size={13} />
            <span>History</span>
            <span className="session-count">{sessions.length}</span>
            <button className="add-session-btn" onClick={createNewSession} title="New session">+</button>
          </div>
          <div className="session-list">
            {sessions.length === 0 && (
              <div className="session-empty">No sessions yet</div>
            )}
            {sessions.map(session => (
              <div
                key={session.id}
                className={`session-item ${viewingSession?.id === session.id ? 'session-item-active' : ''}`}
                onClick={() => renamingSession === session.id ? undefined : (viewingSession?.id === session.id ? exitHistoryMode() : loadSession(session))}
              >
                {renamingSession === session.id ? (
                  <input
                    className="session-rename-input"
                    autoFocus
                    value={renameSessionInput}
                    onChange={e => setRenameSessionInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameSession(session.id, renameSessionInput);
                      if (e.key === 'Escape') setRenamingSession(null);
                    }}
                    onBlur={() => renameSession(session.id, renameSessionInput)}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <div className="session-query">{session.query}</div>
                )}
                <div className="session-meta">
                  <span className="session-date">{new Date(session.created_at).toLocaleString()}</span>
                  <button
                    className="session-rename-btn"
                    onClick={e => { e.stopPropagation(); setRenamingSession(session.id); setRenameSessionInput(session.query); }}
                    title="Rename session"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    className="session-delete-btn"
                    onClick={(e) => confirmDeleteSession(session.id, session.query, e)}
                    title="Delete session"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>{/* end app-main-row */}

      {/* ── Metrics Modal ── */}
      {showMetrics && sysMetrics && (
        <div className="modal-overlay" onClick={() => setShowMetrics(false)}>
          <div className="metrics-modal glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <BarChart2 size={15} className="text-blue-400" />
              <span>Performance Metrics</span>
              <button className="close-btn" onClick={() => setShowMetrics(false)}><X size={14} /></button>
            </div>
            <div className="metrics-modal-grid">
              {[
                { val: sysMetrics.total_runs,
                  label: 'Total Runs',
                  desc: 'End-to-end pipeline executions since deployment' },
                { val: `${sysMetrics.success_rate}%`,
                  label: 'Success Rate',
                  desc: 'Runs that completed without errors (successful_runs / total_runs × 100)' },
                { val: fmtTime(sysMetrics.avg_time_seconds),
                  label: 'Avg. Pipeline Time',
                  desc: 'Mean wall-clock time from query submission to finished brief' },
                { val: sysMetrics.total_papers,
                  label: 'Papers Processed',
                  desc: 'Total arXiv abstracts fetched and synthesised across all runs' },
                { val: Math.round(sysMetrics.avg_graph_nodes),
                  label: 'Avg. Graph Nodes',
                  desc: 'Mean number of concepts extracted per knowledge graph' },
                { val: sysMetrics.steps_automated,
                  label: 'Steps Automated',
                  desc: '7 specialised agents run sequentially with zero human input per run' },
                { val: sysMetrics.successful_runs,
                  label: 'Sessions Saved',
                  desc: 'Runs with full data persisted to the session history database' },
                { val: `~${Math.max(1, 60 - Math.round(sysMetrics.avg_time_seconds / 60))} min`,
                  label: 'Time Saved / Run',
                  desc: 'Estimated savings vs. manual review (~60 min baseline) minus avg. pipeline time' },
              ].map(({ val, label, desc }) => (
                <div key={label} className="metrics-card glass">
                  <div className="metrics-card-val">{val}</div>
                  <div className="metrics-card-label">{label}</div>
                  <div className="metrics-card-desc">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ── */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="confirm-modal glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">Delete session?</div>
            <p className="confirm-msg">
              "<span className="confirm-query">{deleteConfirm.query}</span>"
              will be permanently removed from history.
            </p>
            <div className="modal-actions">
              <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn-danger" onClick={deleteSession}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── File Delete Confirmation ── */}
      {deleteFileConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteFileConfirm(null)}>
          <div className="confirm-modal glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">Delete file?</div>
            <p className="confirm-msg">
              "<span className="confirm-query">{deleteFileConfirm.filename}</span>"
              will be permanently removed from the <strong>{deleteFileConfirm.folder}/</strong> folder.
            </p>
            <div className="modal-actions">
              <button onClick={() => setDeleteFileConfirm(null)}>Cancel</button>
              <button className="btn-danger" onClick={deleteFile}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── arXiv Search Modal ── */}
      {showArxivSearch && (
        <div className="modal-overlay" onClick={() => setShowArxivSearch(false)}>
          <div className="new-file-modal glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <Search size={14} className="text-blue-400" />
              <span>Search arXiv (full papers)</span>
              <button className="close-btn" onClick={() => setShowArxivSearch(false)}><X size={14} /></button>
            </div>

            <input
              className="modal-input"
              placeholder="Search query (e.g. attention mechanisms in transformers)"
              value={arxivQuery}
              onChange={e => setArxivQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runArxivSearch()}
              autoFocus
            />

            <div className="arxiv-search-options">
              <div className="settings-item">
                <label>Papers <span className="settings-val">{arxivCount}</span></label>
                <input type="range" min="1" max="10" value={arxivCount}
                  onChange={e => setArxivCount(+e.target.value)} />
              </div>
              <div className="settings-item">
                <label>Sort</label>
                <select value={arxivSort} onChange={e => setArxivSort(e.target.value)}>
                  <option value="relevance">Relevance</option>
                  <option value="recent">Most Recent</option>
                </select>
              </div>
            </div>

            {arxivBusy && (
              <div className="arxiv-status">
                <CircleDashed size={14} className="text-blue-400 animate-spin" />
                Downloading full papers from arXiv… this may take a moment
              </div>
            )}

            {arxivResult && !arxivBusy && (
              <div className="arxiv-results">
                {arxivResult.error ? (
                  <div className="arxiv-error">{arxivResult.error}</div>
                ) : (
                  arxivResult.files.map((f, i) => (
                    <div key={i} className="arxiv-result-item">
                      <FileText size={12} className={f.status === 'new' ? 'text-emerald-400' : 'text-slate-500'} />
                      <span>{f.filename}</span>
                      <span className="arxiv-badge">{f.status}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="modal-actions">
              <button onClick={() => setShowArxivSearch(false)}>Close</button>
              <button className="btn-primary" onClick={runArxivSearch} disabled={arxivBusy || !arxivQuery.trim()}>
                {arxivBusy ? 'Searching…' : 'Search & Download'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New File Modal ── */}
      {showNewFileModal && (
        <div className="modal-overlay" onClick={uploadBusy ? undefined : resetNewFileModal}>
          <div className="new-file-modal glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Add file to RAW/</span>
              {!uploadBusy && (
                <button className="close-btn" onClick={resetNewFileModal}><X size={14} /></button>
              )}
            </div>

            {uploadBusy ? (
              /* ── Upload loading screen ── */
              <div className="upload-loading">
                <div className="upload-loading-icon">
                  <FileText size={32} className="text-blue-400" />
                  <CircleDashed size={56} className="upload-loading-spinner" />
                </div>
                <div className="upload-loading-name">{selectedFile?.name}</div>
                <div className="upload-loading-sub">Uploading to RAW/…</div>
                <div className="upload-progress-bar">
                  <div className="upload-progress-fill" />
                </div>
              </div>
            ) : (
              <>
                {/* File picker */}
                <label className="file-drop-zone">
                  <input type="file" accept=".pdf,.txt,.md,.csv" style={{ display: 'none' }} onChange={handleFileSelect} />
                  {selectedFile ? (
                    <div className="file-selected-info">
                      <FileText size={20} className="text-blue-400" />
                      <div>
                        <div className="file-selected-name">{selectedFile.name}</div>
                        <div className="file-selected-size">{(selectedFile.size / 1024).toFixed(1)} KB</div>
                      </div>
                      <span className="file-selected-change">Change</span>
                    </div>
                  ) : (
                    <div className="file-drop-hint">
                      <Upload size={22} className="text-slate-600 mb-1" />
                      <p>Click to select a file</p>
                      <p className="file-drop-sub">.pdf · .txt · .md · .csv</p>
                    </div>
                  )}
                </label>

                {/* Editable content preview (text files only) */}
                {newFileContent && !(selectedFile?.name.toLowerCase().endsWith('.pdf')) && (
                  <textarea
                    className="modal-textarea"
                    value={newFileContent}
                    onChange={e => setNewFileContent(e.target.value)}
                    placeholder="Content preview (editable before upload)"
                  />
                )}

                <div className="modal-actions">
                  <button onClick={resetNewFileModal}>Cancel</button>
                  <button className="btn-primary" onClick={createRawFile} disabled={!selectedFile}>
                    Upload
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Pipeline Done Modal ── */}
      {showPipelineDone && (
        <div className="modal-overlay">
          <div className="confirm-modal glass">
            <div className="modal-header">Pipeline Complete</div>
            <p className="confirm-msg">
              All agents finished successfully. Your knowledge graph, wikis, brief, and hypothesis are ready.
            </p>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => { setShowPipelineDone(false); window.location.reload(); }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
