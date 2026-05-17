import React, { useState, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Bot, FileText, Folder, CheckCircle2, CircleDashed, AlertCircle, MessageSquare, X, Search, Clock, ChevronRight, Send } from 'lucide-react';
import './App.css';

const initialAgents = [
  { id: 'orchestrator', name: 'Orchestrator Agent', status: 'idle', logs: ['System ready.'] },
  { id: 'fetch',        name: 'Fetch Agent',        status: 'idle', logs: ['Waiting for queries.'] },
  { id: 'ingestor',     name: 'Ingestor Agent',     status: 'idle', logs: ['Standing by.'] },
  { id: 'synthesizer',  name: 'Synthesizer Agent',  status: 'idle', logs: ['Ready to compile.'] },
  { id: 'lint',         name: 'Lint Agent',         status: 'idle', logs: ['Gap detection active.'] },
  { id: 'hypothesis',   name: 'Hypothesis Agent',   status: 'idle', logs: ['Awaiting gaps.'] },
  { id: 'writer',       name: 'Writer Agent',       status: 'idle', logs: ['Ready to draft.'] },
  { id: 'query',        name: 'Query Agent',        status: 'idle', logs: ['Chat interface online.'] }
];

// ── Markdown renderer ──────────────────────────────────────────────────────
function renderInline(text, key) {
  const parts = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g);
  return parts.map((part, i) => {
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
    const listMatch = line.match(/^[-*] (.+)/);
    if (!listMatch) flushList(i);

    if      (listMatch)               listItems.push(<li key={i}>{renderInline(listMatch[1], i)}</li>);
    else if (line.startsWith('#### ')) elements.push(<h4 key={i}>{renderInline(line.slice(5), i)}</h4>);
    else if (line.startsWith('### '))  elements.push(<h3 key={i}>{renderInline(line.slice(4), i)}</h3>);
    else if (line.startsWith('## '))   elements.push(<h2 key={i}>{renderInline(line.slice(3), i)}</h2>);
    else if (line.startsWith('# '))    elements.push(<h1 key={i}>{renderInline(line.slice(2), i)}</h1>);
    else if (/^---+$/.test(line.trim())) elements.push(<hr key={i} />);
    else if (line.trim() === '')       elements.push(<div key={i} className="md-spacer" />);
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
  const [files, setFiles]                 = useState({ raw: [], wikis: [], briefs: [] });
  const [selectedBrief, setSelectedBrief] = useState(null);
  const [sessions, setSessions]           = useState([]);
  const [viewingSession, setViewingSession] = useState(null);
  const [sessionData, setSessionData]     = useState(null);
  const [pipelineHasRun, setPipelineHasRun] = useState(false);
  const [chatOpen, setChatOpen]       = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello! Ask me anything about the compiled knowledge base.' }
  ]);
  const [chatInput, setChatInput]     = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const graphRef        = useRef();
  const wsRef           = useRef(null);
  const currentGraphRef = useRef({ nodes: [], links: [] });
  const chatEndRef      = useRef(null);

  // Only show graph/file content when a pipeline has run or a session is loaded
  const hasContent = pipelineHasRun || !!viewingSession;

  // Derive display lists: session data (with content) or filesystem filenames
  const displayRaw    = sessionData?.raw_files   ?? files.raw.map(f   => ({ filename: f, content: null }));
  const displayWikis  = sessionData?.wiki_files  ?? files.wikis.map(f => ({ filename: f, content: null }));
  const displayBriefs = sessionData
    ? [{ filename: 'brief.md', content: sessionData.brief }]
    : files.briefs.map(f => ({ filename: f, content: null }));

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/chat', {
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
      const res = await fetch('http://localhost:8000/api/files');
      if (res.ok) setFiles(await res.json());
    } catch (err) { console.error('fetchFiles', err); }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/sessions');
      if (res.ok) setSessions(await res.json());
    } catch (err) { console.error('fetchSessions', err); }
  };

  const fetchBrief = async (filename) => {
    try {
      const res = await fetch(`http://localhost:8000/api/brief/${filename}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBrief({ filename, content: data.content });
      }
    } catch (err) { console.error('fetchBrief', err); }
  };

  // Open any file: use in-memory content if available, otherwise hit the API
  const handleFileOpen = async (fileObj, folder) => {
    if (fileObj.content != null) {
      setSelectedBrief({ filename: fileObj.filename, content: fileObj.content });
      return;
    }
    try {
      const res = await fetch(`http://localhost:8000/api/${folder}/${fileObj.filename}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBrief({ filename: fileObj.filename, content: data.content });
      }
    } catch (err) { console.error('handleFileOpen', err); }
  };

  // ── Session management ───────────────────────────────────────────────────
  const loadSession = async (session) => {
    try {
      const res = await fetch(`http://localhost:8000/api/sessions/${session.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setGraphData(data.graph_data || { nodes: [], links: [] });
      setSessionData(data);
      setSelectedBrief({ filename: session.query, content: data.brief || '' });
      setViewingSession(session);
    } catch (err) { console.error('loadSession', err); }
  };

  const exitHistoryMode = () => {
    setGraphData(currentGraphRef.current);
    setSelectedBrief(null);
    setViewingSession(null);
    setSessionData(null);
  };

  // ── WebSocket + mount ───────────────────────────────────────────────────
  useEffect(() => {
    fetchFiles();
    fetchSessions();
    // No fetchGraph on mount — start blank until a run or session load

    const ws = new WebSocket('ws://localhost:8000/ws/logs');
    wsRef.current = ws;

    ws.onopen = () =>
      setGlobalLogs(prev => [...prev, { type: 'success', text: '[System] Connected to OmniSynth backend WebSocket.' }]);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'info') {
          setGlobalLogs(prev => [...prev, { type: 'info', text: `[System] ${data.text}` }]);
        } else if (data.type === 'status') {
          updateAgentStatus(data.agent, data.status, data.log);
          if (data.graph_data) {
            setGraphData(data.graph_data);
            currentGraphRef.current = data.graph_data;
          }
          if (data.agent === 'orchestrator' && data.status === 'success' && data.log.includes('Pipeline execution finished')) {
            setIsProcessing(false);
            setPipelineHasRun(true);
            setViewingSession(null);
            setSessionData(null);
            fetchFiles();
            fetchSessions();
            fetchBrief('brief.md');
          }
        }
      } catch (err) { console.error('ws.onmessage', err); }
    };

    ws.onerror = () =>
      setGlobalLogs(prev => [...prev, { type: 'error', text: '[System] WebSocket connection error.' }]);

    ws.onclose = () =>
      setGlobalLogs(prev => [...prev, { type: 'warning', text: '[System] WebSocket connection closed.' }]);

    return () => { if (ws.readyState === 1) ws.close(); };
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleQuery = async (e) => {
    if (e.key !== 'Enter' || !query.trim() || isProcessing) return;
    setIsProcessing(true);
    setAgents(prev => prev.map(a => ({ ...a, status: 'idle' })));
    setGlobalLogs(prev => [...prev, { type: 'info', text: `[User] Triggered query: "${query}"` }]);
    try {
      const res = await fetch('http://localhost:8000/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setGlobalLogs(prev => [...prev, { type: 'error', text: `[System] API Request failed: ${err.message}` }]);
      setIsProcessing(false);
    }
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

  const getNodeColor = (group) => {
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#ec4899'];
    return colors[group % colors.length];
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container text-white">

      {/* ── Left Sidebar ── */}
      <div className="sidebar-left glass">
        <div className="header">
          <h1><Bot size={20} /> OmniSynth Agents</h1>
        </div>
        <div className="agent-list">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`agent-card ${activeAgent.id === agent.id ? 'active' : ''}`}
              onClick={() => setActiveAgent(agent)}
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
          <div className="logs-label">System Logs</div>
          {globalLogs.map((log, i) => (
            <div key={i} className={`log-entry log-${log.type}`}>{log.text}</div>
          ))}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="main-content">
        <div className="query-bar glass">
          <div className="query-bar-inner">
            <Search className="query-icon" size={18} />
            <input
              type="text"
              className="query-input"
              placeholder="Ask a research question..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleQuery}
              disabled={isProcessing}
            />
          </div>
        </div>

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
                  onNodeClick={node => setSelectedNode(node)}
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
                {selectedNode && (
                  <div className="node-details-panel glass">
                    <button className="close-btn" onClick={() => setSelectedNode(null)}><X size={16} /></button>
                    <h3 className="text-lg font-semibold mb-2">{selectedNode.name}</h3>
                    <div className="text-sm text-slate-300">
                      <p>Type: Group {selectedNode.group}</p>
                      <p>Connections: {graphData.links.filter(l =>
                        l.source?.id === selectedNode.id || l.target?.id === selectedNode.id ||
                        l.source === selectedNode.id    || l.target === selectedNode.id
                      ).length}</p>
                    </div>
                  </div>
                )}
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
                      {msg.content}
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
                  <button className="close-btn brief-close" onClick={() => { setSelectedBrief(null); if (viewingSession) exitHistoryMode(); }}>
                    <X size={15} />
                  </button>
                </div>
                <div className="brief-content">
                  <MarkdownRenderer content={selectedBrief.content} />
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
          {/* RAW */}
          <div className="folder">
            <div className="folder-title"><Folder size={14} /> RAW/</div>
            {hasContent && displayRaw.map((file, i) => (
              <div
                key={i}
                className={`file-item file-item-clickable ${selectedBrief?.filename === file.filename && !viewingSession ? 'file-item-active' : ''}`}
                onClick={() => handleFileOpen(file, 'raw')}
              >
                <FileText size={13} className="text-blue-400 flex-shrink-0" />
                <span className="truncate">{file.filename}</span>
              </div>
            ))}
          </div>

          {/* WIKIS */}
          <div className="folder">
            <div className="folder-title"><Folder size={14} /> WIKIS/</div>
            {hasContent && displayWikis.map((file, i) => (
              <div
                key={i}
                className={`file-item file-item-clickable ${selectedBrief?.filename === file.filename && !viewingSession ? 'file-item-active' : ''}`}
                onClick={() => handleFileOpen(file, 'wiki')}
              >
                <FileText size={13} className="text-purple-400 flex-shrink-0" />
                <span className="truncate">{file.filename}</span>
              </div>
            ))}
          </div>

          {/* BRIEFS */}
          <div className="folder">
            <div className="folder-title"><Folder size={14} /> BRIEFS/</div>
            {hasContent && displayBriefs.map((file, i) => (
              <div
                key={i}
                className={`file-item file-item-clickable ${selectedBrief?.filename === file.filename && !viewingSession ? 'file-item-active' : ''}`}
                onClick={() => { exitHistoryMode(); handleFileOpen(file, 'brief'); }}
              >
                <FileText size={13} className="text-emerald-400 flex-shrink-0" />
                <span className="truncate">{file.filename}</span>
              </div>
            ))}
          </div>
        </div>

        {/* History */}
        <div className="history-section">
          <div className="history-header">
            <Clock size={13} />
            <span>History</span>
            <span className="session-count">{sessions.length}</span>
          </div>
          <div className="session-list">
            {sessions.length === 0 && (
              <div className="session-empty">No sessions yet</div>
            )}
            {sessions.map(session => (
              <div
                key={session.id}
                className={`session-item ${viewingSession?.id === session.id ? 'session-item-active' : ''}`}
                onClick={() => loadSession(session)}
              >
                <div className="session-query">{session.query}</div>
                <div className="session-meta">
                  <span className="session-date">{new Date(session.created_at).toLocaleString()}</span>
                  <ChevronRight size={12} className="session-arrow" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
