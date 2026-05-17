import React, { useState, useEffect, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Bot, FileText, Folder, CheckCircle2, CircleDashed, AlertCircle, MessageSquare, X, Search } from 'lucide-react';
import './App.css';

// Mocked initial state
const initialAgents = [
  { id: 'orchestrator', name: 'Orchestrator Agent', status: 'idle', logs: ['System ready.'] },
  { id: 'fetch', name: 'Fetch Agent', status: 'idle', logs: ['Waiting for queries.'] },
  { id: 'ingestor', name: 'Ingestor Agent', status: 'idle', logs: ['Standing by.'] },
  { id: 'synthesizer', name: 'Synthesizer Agent', status: 'idle', logs: ['Ready to compile.'] },
  { id: 'lint', name: 'Lint Agent', status: 'idle', logs: ['Gap detection active.'] },
  { id: 'hypothesis', name: 'Hypothesis Agent', status: 'idle', logs: ['Awaiting gaps.'] },
  { id: 'writer', name: 'Writer Agent', status: 'idle', logs: ['Ready to draft.'] },
  { id: 'query', name: 'Query Agent', status: 'idle', logs: ['Chat interface online.'] }
];

function App() {
  const [agents, setAgents] = useState(initialAgents);
  const [activeAgent, setActiveAgent] = useState(initialAgents[0]);
  const [globalLogs, setGlobalLogs] = useState([
    { type: 'info', text: '[System] OmniSynth Multi-Agent Pipeline initialized.' },
    { type: 'info', text: '[System] Knowledge Graph Engine loaded.' }
  ]);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [files, setFiles] = useState({ raw: [], wikis: [], briefs: [] });

  const fetchFiles = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/files');
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch (err) {
      console.error("Failed to fetch files", err);
    }
  };

  const graphRef = useRef();

  const wsRef = useRef(null);

  useEffect(() => {
    // Connect to WebSocket
    const ws = new WebSocket('ws://localhost:8000/ws/logs');
    wsRef.current = ws;

    ws.onopen = () => {
      setGlobalLogs(prev => [...prev, { type: 'success', text: '[System] Connected to OmniSynth backend WebSocket.' }]);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'info') {
          setGlobalLogs(prev => [...prev, { type: 'info', text: `[System] ${data.text}` }]);
        } else if (data.type === 'status') {
          updateAgentStatus(data.agent, data.status, data.log);
          if (data.graph_data) {
            setGraphData(data.graph_data);
          }
          if (data.agent === 'orchestrator' && data.status === 'success' && data.log.includes('Pipeline execution finished')) {
            setIsProcessing(false);
            fetchFiles();
          }
        }
      } catch (err) {
        console.error("Failed to parse websocket message", err);
      }
    };

    ws.onerror = (error) => {
      setGlobalLogs(prev => [...prev, { type: 'error', text: '[System] WebSocket connection error.' }]);
    };

    ws.onclose = () => {
      setGlobalLogs(prev => [...prev, { type: 'warning', text: '[System] WebSocket connection closed.' }]);
    };

    // Initial fetch of files
    fetchFiles();

    return () => {
      if (ws.readyState === 1) {
        ws.close();
      }
    };
  }, []);

  const handleSimulateQuery = async (e) => {
    if (e.key === 'Enter' && query.trim() !== '') {
      setIsProcessing(true);
      
      // Reset agent logs for new query
      setAgents(prev => prev.map(a => ({ ...a, status: 'idle' })));
      setGlobalLogs(prev => [...prev, { type: 'info', text: `[User] Triggered query: "${query}"` }]);
      
      try {
        const response = await fetch('http://localhost:8000/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        setGlobalLogs(prev => [...prev, { type: 'error', text: `[System] API Request failed: ${error.message}` }]);
        setIsProcessing(false);
      }
    }
  };

  const updateAgentStatus = (id, status, log) => {
    setAgents(prev => prev.map(a => {
      if (a.id === id) {
        return { ...a, status, logs: [...a.logs, log] };
      }
      return a;
    }));
    setGlobalLogs(prev => [...prev, { type: status === 'error' ? 'error' : 'info', text: `[${id.toUpperCase()}] ${log}` }]);
  };

  const StatusIcon = ({ status }) => {
    if (status === 'running') return <CircleDashed className="text-blue-400 animate-spin" size={16} />;
    if (status === 'success') return <CheckCircle2 className="text-emerald-400" size={16} />;
    if (status === 'error') return <AlertCircle className="text-red-400" size={16} />;
    return <span className="status-dot status-idle"></span>;
  };

  const getNodeColor = (group) => {
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#ec4899'];
    return colors[group % colors.length];
  };

  return (
    <div className="app-container text-white">
      {/* Left Sidebar: Agents */}
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
              <div className="agent-status-text text-slate-400 truncate text-xs">
                {agent.logs[agent.logs.length - 1]}
              </div>
            </div>
          ))}
        </div>

        {/* Global Logs Area */}
        <div className="global-logs border-t border-white/10">
          <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">System Logs</div>
          {globalLogs.map((log, i) => (
            <div key={i} className={`log-entry log-${log.type}`}>
              {log.text}
            </div>
          ))}
          {/* Dummy element to auto-scroll to bottom could go here */}
        </div>
      </div>

      {/* Main Content: Knowledge Graph */}
      <div className="main-content">
        <div className="query-input-container">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              className="query-input pl-12" 
              placeholder="Ask a research question..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSimulateQuery}
              disabled={isProcessing}
            />
          </div>
        </div>

        <div className="graph-container">
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            nodeLabel=""
            nodeColor={node => getNodeColor(node.group)}
            nodeRelSize={6}
            linkColor={() => 'rgba(255,255,255,0.2)'}
            backgroundColor="transparent"
            onNodeClick={(node) => setSelectedNode(node)}
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
        </div>

        {/* Node Details Popover */}
        {selectedNode && (
          <div className="node-details-panel glass">
            <button className="close-btn" onClick={() => setSelectedNode(null)}>
              <X size={16} />
            </button>
            <h3 className="text-lg font-semibold mb-2">{selectedNode.name}</h3>
            <div className="text-sm text-slate-300 mb-4">
              <p>Type: Group {selectedNode.group}</p>
              <p>Connections: {graphData.links.filter(l => l.source.id === selectedNode.id || l.target.id === selectedNode.id).length}</p>
            </div>
            <div className="bg-black/30 p-3 rounded text-xs text-slate-400 font-mono">
              {"// Simulated content data\n"}
              {"{\n"}
              {`  "id": "${selectedNode.id}",\n`}
              {`  "status": "compiled"\n`}
              {"}"}
            </div>
            <button className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded transition-colors text-sm font-medium">
              View Full Source
            </button>
          </div>
        )}

        {/* Chat FAB */}
        <div className="fab-container">
          <button className="fab-button" title="Chat with Compiled Knowledge Base">
            <MessageSquare size={24} />
          </button>
        </div>
      </div>

      {/* Right Sidebar: Files */}
      <div className="sidebar-right glass">
        <div className="header">
          <h1><Folder size={20} /> Knowledge Base</h1>
        </div>
        <div className="file-explorer">
          
          <div className="folder">
            <div className="folder-title"><Folder size={16} /> raw/</div>
            {files.raw.map((file, i) => (
              <div key={i} className="file-item">
                <FileText size={14} className="text-blue-400" />
                <span className="truncate">{file}</span>
              </div>
            ))}
          </div>

          <div className="folder">
            <div className="folder-title"><Folder size={16} /> wikis/</div>
            {files.wikis.map((file, i) => (
              <div key={i} className="file-item">
                <FileText size={14} className="text-purple-400" />
                <span className="truncate">{file}</span>
              </div>
            ))}
          </div>

          <div className="folder">
            <div className="folder-title"><Folder size={16} /> briefs/</div>
            {files.briefs.map((file, i) => (
              <div key={i} className="file-item">
                <FileText size={14} className="text-emerald-400" />
                <span className="truncate">{file}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
