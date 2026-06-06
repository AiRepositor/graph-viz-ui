'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const ForceGraph = dynamic(() => import('@/components/ForceGraph2D'), { ssr: false });

// ── Types ──
interface GraphNode { id: string; name: string; type: string; subtype?: string; cluster?: string; count?: number; metadata?: Record<string, any>; }
interface GraphEdge { source: string; target: string; kind: string; label: string; color: string; style: string; }
interface GraphData { title: string; stats: { total_nodes: number; total_edges: number; total_clusters: number; types: Record<string, number> }; nodes: GraphNode[]; edges: GraphEdge[]; clusters: { id: string; name: string; color: string }[]; }

const TYPE_COLORS: Record<string, string> = {
  repo: '#58a6ff', skill: '#3fb950', profile: '#d29922', config: '#e3b341',
  cron: '#56d4dd', plugin: '#a882ff', tool: '#db61a2', session: '#79c0ff',
};
const TYPE_DOMAIN_NAMES: Record<string, string> = {
  repo: '📦 Repos', skill: '🧠 Skills', profile: '👤 Profiles',
  config: '⚙️ Config', cron: '⏱ Cron', plugin: '🔌 Plugins',
  tool: '🔧 Tools', session: '📋 Sessions',
};
const TYPE_DEFAULT = '#484f58';
const DOMAIN_ORDER = ['repo', 'skill', 'config', 'profile', 'cron', 'plugin', 'tool', 'session'];

// ── Debounce hook ──
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Spinner component ──
function Spinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 32, height: 32,
        border: '3px solid #30363d', borderTopColor: '#58a6ff',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: '#8b949e', fontSize: 14 }}>Loading graph...</p>
    </div>
  );
}

// ── Main App ──
export default function GraphVizApp() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterClusters, setFilterClusters] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(true);
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());
  const [explodedNodeId, setExplodedNodeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dataKeyRef = useRef(0); // force remount counter for graph

  const debouncedSearch = useDebounce(searchQuery, 150);

  // ── Load data ──
  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch('/data.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: GraphData = await resp.json();
        setData(json);
        // Default: show ALL types (full deep view)
        setFilterTypes(new Set(Object.keys(json.stats.types)));
      } catch (e: any) {
        setError(e.message || 'Failed to load graph data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Stable memoization: only recompute when data, filters, or search changes ──
  const filteredNodes = useMemo(() => {
    if (!data) return [];
    const q = debouncedSearch.toLowerCase();
    return data.nodes.filter(n => {
      if (q && !n.name.toLowerCase().includes(q)) return false;
      if (filterTypes.size > 0 && !filterTypes.has(n.type)) return false;
      if (filterClusters.size > 0 && n.cluster && !filterClusters.has(n.cluster)) return false;
      return true;
    });
  }, [data, debouncedSearch, filterTypes, filterClusters]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));
  }, [data, filteredNodeIds]);

  // Stable references for ForceGraph: stringify → parse to avoid shallow-equality thrash
  const graphDataKey = useMemo(() => JSON.stringify({ nodes: filteredNodes, edges: filteredEdges }), [filteredNodes, filteredEdges]);
  const graphData = useMemo(() => {
    const parsed = JSON.parse(graphDataKey);
    return {
      nodes: parsed.nodes.map((n: GraphNode) => ({
        id: n.id, name: n.name,
        val: n.type === 'repo' ? 16
           : n.type === 'skill' ? 8 + (n.count ? Math.min(n.count, 30) * 0.4 : 0)
           : n.type === 'config' ? 7 : 6,
        // Primary color = type domain, with subtle cluster tint
        color: TYPE_COLORS[n.type] || TYPE_DEFAULT,
        type: n.type, cluster: n.cluster || '',
      })),
      links: parsed.edges.map((e: GraphEdge) => ({
        source: e.source, target: e.target, label: e.label, color: e.color,
      })),
    };
  }, [graphDataKey, data]);

  const clusterColorMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.clusters.map(c => [c.name, c.color]));
  }, [data]);

  const availableTypes = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.stats.types).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
  }, [data]);

  const availableClusters = useMemo(() => {
    if (!data) return [];
    return data.clusters.map(c => c.name);
  }, [data]);

  const toggleType = useCallback((t: string) => {
    setFilterTypes(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });
    setSelectedNode(null);
  }, []);

  const toggleCluster = useCallback((c: string) => {
    setFilterClusters(prev => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; });
    setSelectedNode(null);
  }, []);

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setFilterTypes(new Set(Object.keys(data?.stats.types || {})));
    setFilterClusters(new Set());
    setSelectedNode(null);
    setCollapsedClusters(new Set());
    setExplodedNodeId(null);
    dataKeyRef.current++;
  }, [data]);

  const handleLoadFile = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        setData(json);
        setFilterTypes(new Set(Object.keys(json.stats.types)));
        setFilterClusters(new Set());
        setSelectedNode(null);
        setSearchQuery('');
        setLoading(false);
      } catch {}
    };
    input.click();
  }, []);

  // ── Render ──
  if (loading) {
    return (
      <div className="app-layout">
        <div className="empty-state">
          <Spinner />
          <p style={{ color: '#8b949e', marginTop: 8 }}>Run <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4 }}>graph_view()</code> or load a file.</p>
          <button className="btn btn-primary" onClick={handleLoadFile}>Load Graph File</button>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="app-layout">
        <div className="empty-state">
          <div style={{ fontSize: 48 }}>📊</div>
          <h2>No graph data loaded</h2>
          <button className="btn btn-primary" onClick={handleLoadFile}>Browse Graph Files</button>
        </div>
      </div>
    );
  }

  const filteredCount = filteredNodes.length;
  const totalCount = data.stats.total_nodes;

  return (
    <div className="app-layout">
      {/* Top bar */}
      <div className="top-bar">
        <h1>📊  GraphViz</h1>
        <span className="stats">
          {filteredCount}/{totalCount} nodes · {filteredEdges.length} edges · {data.stats.total_clusters} clusters
        </span>
        <button className="btn" onClick={() => setPanelOpen(o => !o)} style={{ minWidth: 36 }}>
          {panelOpen ? '☰' : '☰'}
        </button>
        <button className="btn" onClick={handleLoadFile}>Load</button>
      </div>

      <div className="main-area">
        {/* Graph */}
        <div className="graph-area">
          {graphData.nodes.length > 0 ? (
            <ForceGraph
              key={dataKeyRef.current}
              nodes={graphData.nodes}
              links={graphData.links}
              selectedId={selectedNode?.id || null}
              collapsedClusters={collapsedClusters}
              explodedId={explodedNodeId}
              onNodeClick={(node: any) => {
                const n = data.nodes.find(n => n.id === node.id);
                setSelectedNode(n || null);
              }}
              onBackgroundClick={() => setSelectedNode(null)}
              onClusterToggle={(cluster: string) => {
                setCollapsedClusters(prev => {
                  const next = new Set(prev);
                  if (next.has(cluster)) next.delete(cluster); else next.add(cluster);
                  return next;
                });
              }}
              onExplodeToggle={(nodeId: string | null) => {
                setExplodedNodeId(nodeId);
                if (nodeId) setSelectedNode(null);
              }}
            />
          ) : (
            <div className="empty-state" style={{ height: '100%' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <p>No nodes match current filters.</p>
              <button className="btn" onClick={resetFilters} style={{ marginTop: 8 }}>Reset Filters</button>
            </div>
          )}
          <div className="instructions">Click to inspect · Double-click to explode · Click cluster bg to collapse · Drag/zoom</div>
        </div>

        {/* Side panel */}
        {panelOpen && (
          <div className="side-panel">
            {selectedNode && (
              <div className="node-detail">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h2>{selectedNode.name}{selectedNode.count ? ` (${selectedNode.count})` : ''}</h2>
                  <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setSelectedNode(null)}>✕</button>
                </div>
                <span className="type-badge" style={{ background: (TYPE_COLORS[selectedNode.type] || TYPE_DEFAULT) + '33', color: TYPE_COLORS[selectedNode.type] || TYPE_DEFAULT }}>
                  {selectedNode.type}{selectedNode.subtype ? ` · ${selectedNode.subtype}` : ''}
                </span>
                {selectedNode.cluster && (
                  <div className="meta-row"><span className="meta-label">Group</span><span className="meta-value">{selectedNode.cluster}</span></div>
                )}
                {selectedNode.metadata && Object.entries(selectedNode.metadata).slice(0, 10).map(([k, v]) => (
                  v ? <div className="meta-row" key={k}><span className="meta-label">{k}</span><span className="meta-value">{String(v).slice(0, 60)}</span></div> : null
                ))}
              </div>
            )}

            <div className="filter-section">
              <input ref={inputRef} className="search-input" type="text" placeholder="Search nodes..."
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>

            <div className="filter-section">
              <h3>🧭 Domains</h3>
              <div className="filter-tags">
                {DOMAIN_ORDER.filter(d => availableTypes.find(t => t.type === d)).map((type) => {
                  const info = availableTypes.find(t => t.type === type);
                  if (!info) return null;
                  return (
                    <span key={type}
                      className={`filter-tag ${filterTypes.has(type) ? 'active' : 'inactive'}`}
                      style={{ background: (TYPE_COLORS[type] || TYPE_DEFAULT) + '22', color: TYPE_COLORS[type] || TYPE_DEFAULT }}
                      onClick={() => toggleType(type)}>
                      {TYPE_DOMAIN_NAMES[type] || type} ({info.count})
                    </span>
                  );
                })}
              </div>
              {filterTypes.size < Object.keys(data.stats.types).length && (
                <button className="btn" onClick={() => setFilterTypes(new Set(Object.keys(data.stats.types)))}
                  style={{ width: '100%', marginTop: 8, justifyContent: 'center', fontSize: 11 }}>Show all</button>
              )}
            </div>

            {availableClusters.length > 0 && (
              <div className="filter-section">
                <h3>Filter by group</h3>
                <div className="filter-tags">
                  {availableClusters.map(c => {
                    const active = filterClusters.size === 0 || filterClusters.has(c);
                    const cc = clusterColorMap.get(c) || '#484f58';
                    return (
                      <span key={c}
                        className={`filter-tag ${active ? 'active' : 'inactive'}`}
                        style={{ background: cc + '33', borderColor: active ? cc : 'transparent' }}
                        onClick={() => toggleCluster(c)}>
                        {c}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {filterTypes.size < Object.keys(data.stats.types).length || filterClusters.size > 0 || collapsedClusters.size > 0 ? (
              <div className="filter-section">
                <button className="btn" onClick={resetFilters} style={{ width: '100%', justifyContent: 'center' }}>Reset all filters</button>
              </div>
            ) : null}

            <div className="legend">
              <h3>🎨 Color legend</h3>
              {Object.entries(TYPE_COLORS).filter(([type]) => data.stats.types[type]).map(([type, color]) => (
                <div className="legend-item" key={type}>
                  <div className="legend-dot" style={{ background: color }} />
                  <span>{TYPE_DOMAIN_NAMES[type] || type} <span style={{ color: '#8b949e', fontSize: 11 }}>({data.stats.types[type]})</span></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
