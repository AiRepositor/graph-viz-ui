'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const ForceGraph = dynamic(() => import('@/components/ForceGraph2D'), { ssr: false });

// ── Types ──
interface GraphNode { id: string; name: string; type: string; subtype?: string; cluster?: string; count?: number; metadata?: Record<string, any>; }
interface GraphEdge { source: string; target: string; kind: string; label: string; color: string; style: string; }
interface GraphData { title: string; stats: { total_nodes: number; total_edges: number; total_clusters: number; types: Record<string, number> }; nodes: GraphNode[]; edges: GraphEdge[]; clusters: { id: string; name: string; color: string }[]; }

const TYPE_COLORS: Record<string, string> = {
  repo: '#0f3460', skill: '#2d6a4f', profile: '#6a2d2d', config: '#6a6a2d',
  cron: '#2d4a6a', plugin: '#6a2d6a', tool: '#2d6a6a', session: '#4a4a6a',
};
const TYPE_DEFAULT = '#484f58';

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
        // Default: repos only
        if (json.stats.types['repo']) {
          setFilterTypes(new Set(['repo']));
        } else {
          setFilterTypes(new Set(Object.keys(json.stats.types)));
        }
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
        val: n.type === 'skill' ? (n.count ? 6 + Math.min(n.count, 30) * 0.5 : 8)
           : n.type === 'repo' ? 12
           : n.type === 'config' ? 8 : 6,
        color: data?.clusters.find(c => c.name === n.cluster)?.color || TYPE_COLORS[n.type] || TYPE_DEFAULT,
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
    setFilterTypes(data?.stats.types['repo'] ? new Set(['repo']) : new Set(Object.keys(data?.stats.types || {})));
    setFilterClusters(new Set());
    setSelectedNode(null);
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
        setFilterTypes(json.stats.types['repo'] ? new Set(['repo']) : new Set(Object.keys(json.stats.types)));
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
          {filteredCount}/{totalCount} nodes · {filteredEdges.length} edges · {data.stats.total_clusters} groups
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
              onNodeClick={(node: any) => {
                const n = data.nodes.find(n => n.id === node.id);
                setSelectedNode(n || null);
              }}
              onBackgroundClick={() => setSelectedNode(null)}
            />
          ) : (
            <div className="empty-state" style={{ height: '100%' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <p>No nodes match current filters.</p>
              <button className="btn" onClick={resetFilters} style={{ marginTop: 8 }}>Reset Filters</button>
            </div>
          )}
          <div className="instructions">Drag to pan · Scroll to zoom · Click to inspect</div>
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
              <h3>Filter by type</h3>
              <div className="filter-tags">
                {availableTypes.map(({ type, count }) => (
                  <span key={type}
                    className={`filter-tag ${filterTypes.has(type) ? 'active' : 'inactive'}`}
                    style={{ background: (TYPE_COLORS[type] || TYPE_DEFAULT) + '22', color: TYPE_COLORS[type] || TYPE_DEFAULT }}
                    onClick={() => toggleType(type)}>
                    {type} ({count})
                  </span>
                ))}
              </div>
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

            {filterClusters.size > 0 || !(filterTypes.size === 1 && filterTypes.has('repo')) ? (
              <div className="filter-section">
                <button className="btn" onClick={resetFilters} style={{ width: '100%', justifyContent: 'center' }}>Reset all filters</button>
              </div>
            ) : null}

            <div className="legend">
              <h3>Node types</h3>
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div className="legend-item" key={type}>
                  <div className="legend-dot" style={{ background: color }} />
                  <span>{type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
