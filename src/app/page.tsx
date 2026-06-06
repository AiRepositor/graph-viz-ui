'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

// Dynamic import for the heavy graph component
const ForceGraph = dynamic(() => import('@/components/ForceGraph2D'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  cluster?: string;
  metadata?: Record<string, any>;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: string;
  label: string;
  color: string;
  style: string;
}

interface GraphData {
  title: string;
  stats: { total_nodes: number; total_edges: number; total_clusters: number; types: Record<string, number> };
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: { id: string; name: string; color: string }[];
}

// ── Type colors ───────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  repo:    '#0f3460',
  skill:   '#2d6a4f',
  profile: '#6a2d2d',
  config:  '#6a6a2d',
  cron:    '#2d4a6a',
  plugin:  '#6a2d6a',
  tool:    '#2d6a6a',
  session: '#4a4a6a',
};
const TYPE_DEFAULT = '#484f58';

// ── Main App ──────────────────────────────────────────────────────────

export default function GraphVizApp() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterClusters, setFilterClusters] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'graph' | 'list'>('graph');

  // Load graph data
  useEffect(() => {
    async function load() {
      try {
        // Try loading from the default JSON path
        const resp = await fetch('/data.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: GraphData = await resp.json();
        setData(json);
        setFilterTypes(new Set(Object.keys(json.stats.types)));
      } catch (e: any) {
        setError(e.message || 'Failed to load graph data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Filtered data ──
  const filteredNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter(n => {
      if (searchQuery && !n.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterTypes.size > 0 && !filterTypes.has(n.type)) return false;
      if (filterClusters.size > 0 && n.cluster && !filterClusters.has(n.cluster)) return false;
      return true;
    });
  }, [data, searchQuery, filterTypes, filterClusters]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter(e =>
      filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );
  }, [data, filteredNodeIds]);

  // ── Cluster colors from data ──
  const clusterColorMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.clusters.map(c => [c.name, c.color]));
  }, [data]);

  // ── Available filters ──
  const availableTypes = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.stats.types)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  }, [data]);

  const availableClusters = useMemo(() => {
    if (!data) return [];
    return data.clusters.map(c => c.name);
  }, [data]);

  // ── Toggle filters ──
  const toggleType = useCallback((t: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }, []);

  const toggleCluster = useCallback((c: string) => {
    setFilterClusters(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }, []);

  // ── Load file ──
  const handleLoadFile = useCallback(async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        const json = JSON.parse(text);
        setData(json);
        setFilterTypes(new Set(Object.keys(json.stats.types)));
        setSelectedNode(null);
        setSearchQuery('');
        setFilterClusters(new Set());
      };
      input.click();
    } catch {}
  }, []);

  // ── Render ──
  if (loading) {
    return (
      <div className="app-layout">
        <div className="empty-state">
          <div style={{ fontSize: 48 }}>📊</div>
          <h2>Loading graph...</h2>
          <p>Run <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4 }}>graph_view()</code> in Hermes or use the button below to load a graph file.</p>
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
          <p>Run <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4 }}>graph_view()</code> in your Hermes session to generate graph data, then load the JSON file, or click below to browse.</p>
          <button className="btn btn-primary" onClick={handleLoadFile}>Browse Graph Files</button>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Or place <code>data.json</code> in the <code>public/</code> folder and rebuild.
          </p>
        </div>
      </div>
    );
  }

  const graphData = {
    nodes: filteredNodes.map(n => ({
      id: n.id,
      name: n.name,
      val: n.type === 'repo' ? 3 : n.type === 'skill' ? 2 : 1,
      color: clusterColorMap.get(n.cluster || '') || TYPE_COLORS[n.type] || TYPE_DEFAULT,
      type: n.type,
      cluster: n.cluster || '',
    })),
    links: filteredEdges.map(e => ({
      source: e.source,
      target: e.target,
      label: e.label,
      color: e.color,
    })),
  };

  const headerTypes = Object.entries(data.stats.types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  return (
    <div className="app-layout">
      {/* Top bar */}
      <div className="top-bar">
        <h1>📊  GraphViz</h1>
        <span className="stats">
          {data.stats.total_nodes} nodes · {data.stats.total_edges} edges · {data.stats.total_clusters} groups
        </span>
        <button className="btn" onClick={handleLoadFile}>Load File</button>
      </div>

      {/* Main area */}
      <div className="main-area">
        {/* Graph */}
        <div className="graph-area">
          {graphData.nodes.length > 0 ? (
            <ForceGraph
              nodes={graphData.nodes as any}
              links={graphData.links as any}
              selectedId={selectedNode?.id || null}
              onNodeClick={(node: any) => {
                const n = data.nodes.find(n => n.id === node.id);
                setSelectedNode(n || null);
              }}
              onBackgroundClick={() => setSelectedNode(null)}
            />
          ) : (
            <div className="empty-state">
              <p>No nodes match the current filters.</p>
            </div>
          )}

          <div className="instructions">
            Drag to pan · Scroll to zoom · Click a node to inspect
          </div>
        </div>

        {/* Right panel */}
        <div className="side-panel">
          {/* Selected node detail */}
          {selectedNode && (
            <div className="node-detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h2>{selectedNode.name}</h2>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setSelectedNode(null)}
                >✕</button>
              </div>
              <span
                className="type-badge"
                style={{
                  background: (TYPE_COLORS[selectedNode.type] || TYPE_DEFAULT) + '33',
                  color: TYPE_COLORS[selectedNode.type] || TYPE_DEFAULT,
                }}
              >
                {selectedNode.type}{selectedNode.subtype ? ` · ${selectedNode.subtype}` : ''}
              </span>
              {selectedNode.cluster && (
                <div className="meta-row">
                  <span className="meta-label">Group</span>
                  <span className="meta-value">{selectedNode.cluster}</span>
                </div>
              )}
              {selectedNode.metadata && Object.entries(selectedNode.metadata).slice(0, 8).map(([k, v]) => (
                v ? (
                  <div className="meta-row" key={k}>
                    <span className="meta-label">{k}</span>
                    <span className="meta-value">{String(v).slice(0, 60)}</span>
                  </div>
                ) : null
              ))}
            </div>
          )}

          {/* Search */}
          <div className="filter-section">
            <input
              className="search-input"
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSelectedNode(null); }}
            />
          </div>

          {/* Filter by type */}
          <div className="filter-section">
            <h3>Filter by type</h3>
            <div className="filter-tags">
              {availableTypes.map(({ type, count }) => (
                <span
                  key={type}
                  className={`filter-tag ${filterTypes.has(type) ? 'active' : 'inactive'}`}
                  style={{
                    background: (TYPE_COLORS[type] || TYPE_DEFAULT) + '22',
                    color: TYPE_COLORS[type] || TYPE_DEFAULT,
                  }}
                  onClick={() => toggleType(type)}
                >
                  {type} ({count})
                </span>
              ))}
            </div>
          </div>

          {/* Filter by cluster */}
          {availableClusters.length > 0 && (
            <div className="filter-section">
              <h3>Filter by group</h3>
              <div className="filter-tags">
                {availableClusters.map(c => {
                  const active = filterClusters.size === 0 || filterClusters.has(c);
                  const cc = clusterColorMap.get(c) || '#484f58';
                  return (
                    <span
                      key={c}
                      className={`filter-tag ${active ? 'active' : 'inactive'}`}
                      style={{ background: cc + '33', borderColor: active ? cc : 'transparent' }}
                      onClick={() => toggleCluster(c)}
                    >
                      {c}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend */}
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
      </div>
    </div>
  );
}
