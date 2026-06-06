'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface GraphNode {
  id: string; name: string; val: number; color: string; type: string; cluster: string;
  x?: number; y?: number; fx?: number | null; fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode; target: string | GraphNode; label?: string; color?: string;
}

interface Props {
  nodes: GraphNode[]; links: GraphLink[];
  selectedId: string | null;
  collapsedClusters: Set<string>;
  explodedId: string | null;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
  onClusterToggle: (cluster: string) => void;
  onExplodeToggle: (nodeId: string | null) => void;
}

const TYPE_COLORS: Record<string, string> = {
  repo: '#0f3460', skill: '#2d6a4f', profile: '#6a2d2d', config: '#6a6a2d',
  cron: '#2d4a6a', plugin: '#6a2d6a', tool: '#2d6a6a', session: '#4a4a6a',
};

// Domain horizontal band positions (Y coordinate in graph space)
const DOMAIN_Y_BANDS: Record<string, number> = {
  repo: -180,    // top
  tool: -60,
  skill: 60,     // middle
  plugin: 60,
  profile: 180,
  config: 180,   // bottom
  cron: 180,
  session: 180,
};

const BAND_COLORS: Record<string, string> = {
  repo: '#58a6ff', skill: '#3fb950', profile: '#d29922', config: '#e3b341',
  cron: '#56d4dd', plugin: '#a882ff', tool: '#db61a2', session: '#79c0ff',
};

const BAND_LABELS: Record<string, string> = {
  repo: '📦 Repos', skill: '🧠 Skills', profile: '👤 Profiles',
  config: '⚙️ Config', cron: '⏱ Cron', plugin: '🔌 Plugins',
  tool: '🔧 Tools', session: '📋 Sessions',
};

export default function ForceGraph2D({ nodes, links, selectedId, collapsedClusters, explodedId,
  onNodeClick, onBackgroundClick, onClusterToggle, onExplodeToggle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<any>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<any>({ node: null, sx: 0, sy: 0, moved: false });
  const panRef = useRef<any>({ active: false, sx: 0, sy: 0, cx: 0, cy: 0 });
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const explodedRef = useRef<string | null>(null);
  const collapsedRef = useRef<Set<string>>(new Set());
  const tooltipRef = useRef<{ node: any; x: number; y: number } | null>(null);
  const callbacksRef = useRef({ onNodeClick, onBackgroundClick, onClusterToggle, onExplodeToggle });
  const initializedRef = useRef(false);
  const lastClickRef = useRef(0); // for double-click detection

  useEffect(() => {
    callbacksRef.current = { onNodeClick, onBackgroundClick, onClusterToggle, onExplodeToggle };
  }, [onNodeClick, onBackgroundClick, onClusterToggle, onExplodeToggle]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { explodedRef.current = explodedId; }, [explodedId]);
  useEffect(() => { collapsedRef.current = collapsedClusters; }, [collapsedClusters]);

  // ── Simulation: once ──
  useEffect(() => {
    async function init() {
      const d3 = await import('d3-force');
      const simNodes: any[] = nodes.map(n => ({
        ...n, x: n.x ?? (Math.random() - 0.5) * 200, y: n.y ?? (Math.random() - 0.5) * 200,
      }));
      const simLinks = links.map(l => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
        label: l.label, color: l.color,
      }));
      nodesRef.current = simNodes;
      linksRef.current = simLinks;

      const sim = d3.forceSimulation(simNodes)
        .force('link', d3.forceLink(simLinks).id((d: any) => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-250))
        .force('center', d3.forceCenter(0, 0))
        .force('collision', d3.forceCollide().radius((d: any) => Math.max(8, (d.val || 1) * 2.5)))
        // Domain bands: pull each node toward its domain's Y row
        .force('y', d3.forceY((d: any) => DOMAIN_Y_BANDS[d.type] || 0).strength(0.35))
        // Gentle X centering within each band
        .force('x', d3.forceX(0).strength(0.05))
        .alphaDecay(0.015);
      simRef.current = sim;
      initializedRef.current = true;
    }
    init();
    return () => { if (simRef.current) simRef.current.stop(); initializedRef.current = false; };
  }, []);

  // ── Hot-swap data ──
  useEffect(() => {
    if (!simRef.current || !initializedRef.current) return;
    const sim = simRef.current;
    const existingPositions = new Map(nodesRef.current.map((n: any) => [n.id, { x: n.x, y: n.y }]));
    const newNodes: any[] = nodes.map(n => {
      const existing = existingPositions.get(n.id);
      return { ...n, x: existing?.x ?? (Math.random() - 0.5) * 200, y: existing?.y ?? (Math.random() - 0.5) * 200 };
    });
    const newLinks = links.map(l => ({
      source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
      target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
      label: l.label, color: l.color,
    }));
    nodesRef.current = newNodes;
    linksRef.current = newLinks;
    sim.nodes(newNodes);
    sim.force('link')!.links(newLinks);

    // If exploded, do manual positioning instead of sim
    if (explodedId) {
      doExplodeLayout(newNodes, newLinks, explodedId);
      sim.stop();
    } else {
      sim.alpha(0.5).restart();
      setTimeout(() => fitToNodes(), 300);
    }
  }, [nodes, links]);

  // ── Handle explode toggle ──
  useEffect(() => {
    const nds = nodesRef.current;
    const eds = linksRef.current;
    const sim = simRef.current;
    if (!sim || !nds.length) return;

    if (explodedId) {
      doExplodeLayout(nds, eds, explodedId);
      sim.stop();
    } else {
      // Unpin all nodes and restart
      for (const n of nds) { n.fx = null; n.fy = null; }
      sim.alpha(0.5).restart();
      setTimeout(() => fitToNodes(), 500);
    }
  }, [explodedId]);

  function doExplodeLayout(nds: any[], eds: any[], centerId: string) {
    const center = nds.find((n: any) => n.id === centerId);
    if (!center) return;

    // Find connected node IDs
    const connected = new Set<string>();
    const nodeMap = new Map(nds.map((n: any) => [n.id, n]));
    for (const e of eds) {
      const src = typeof e.source === 'object' ? e.source.id : e.source;
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      if (src === centerId) connected.add(tgt);
      if (tgt === centerId) connected.add(src);
    }

    const connectedList = [...connected];
    const radius = Math.max(120, connectedList.length * 25);
    const angleStep = (Math.PI * 2) / Math.max(connectedList.length, 1);

    // Center node at origin
    center.x = 0; center.y = 0;
    center.fx = 0; center.fy = 0;

    // Connected nodes in a circle
    connectedList.forEach((id, i) => {
      const n = nodeMap.get(id);
      if (!n) return;
      const angle = angleStep * i - Math.PI / 2;
      n.x = Math.cos(angle) * radius;
      n.y = Math.sin(angle) * radius;
      n.fx = n.x; n.fy = n.y;
    });

    // Unconnected nodes → push far away
    for (const n of nds) {
      if (n.id === centerId || connected.has(n.id)) continue;
      n.x = 9999; n.y = 9999;
      n.fx = 9999; n.fy = 9999;
    }

    // Fit camera after explode
    setTimeout(() => {
      const cam = cameraRef.current;
      cam.zoom = 1.2;
      cam.x = 0; cam.y = 0;
    }, 50);
  }

  // ── Canvas render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    function resize() {
      if (!canvas || !canvas.parentElement) return;
      canvas.width = canvas.parentElement.clientWidth * devicePixelRatio;
      canvas.height = canvas.parentElement.clientHeight * devicePixelRatio;
      canvas.style.width = canvas.parentElement.clientWidth + 'px';
      canvas.style.height = canvas.parentElement.clientHeight + 'px';
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    function render() {
      if (!canvas) return;
      const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
      const cam = cameraRef.current;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 + cam.x, H / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const nds = nodesRef.current;
      const eds = linksRef.current;
      const exploded = explodedRef.current;
      const collapsed = collapsedRef.current;
      const selected = selectedRef.current;
      const hovered = hoverRef.current;

      const nodeMap = new Map(nds.map((n: any) => [n.id, n]));

      // ── Draw domain bands (horizontal strips by type) ──
      const activeBands = new Map<string, any[]>();
      for (const n of nds) {
        if (n.x == null || Math.abs(n.x) > 5000) continue;
        const t = n.type || 'other';
        if (!activeBands.has(t)) activeBands.set(t, []);
        activeBands.get(t)!.push(n);
      }
      // Collect visible Y positions per band
      for (const [type, members] of activeBands) {
        const targetY = DOMAIN_Y_BANDS[type];
        if (targetY == null) continue;
        const xs = members.map((n: any) => n.x).filter((x: number) => x != null);
        if (!xs.length) continue;
        const minX = Math.min(...xs) - 80;
        const maxX = Math.max(...xs) + 80;
        const bandWidth = maxX - minX;
        const bandColor = BAND_COLORS[type] || '#484f58';

        // Semi-transparent band background
        ctx.beginPath();
        ctx.rect(minX - 20, targetY - 28, bandWidth + 40, 56);
        ctx.fillStyle = bandColor + '0D';
        ctx.fill();
        ctx.strokeStyle = bandColor + '20';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Band label on the left side
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.fillStyle = bandColor + '88';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(BAND_LABELS[type] || type, minX - 16, targetY);
      }

      // ── Build cluster groups (only from visible, non-collapsed nodes) ──
      const clusterGroups = new Map<string, any[]>();
      for (const n of nds) {
        if (!n.cluster || collapsed.has(n.cluster) || n.x == null) continue;
        // Don't include nodes pushed offscreen by explode
        if (Math.abs(n.x) > 5000 || Math.abs(n.y) > 5000) continue;
        if (!clusterGroups.has(n.cluster)) clusterGroups.set(n.cluster, []);
        clusterGroups.get(n.cluster)!.push(n);
      }

      // ── Collapsed cluster hulls ──
      for (const [name, members] of clusterGroups) {
        if (members.length < 2) continue;
        const cx = members.reduce((s: number, m: any) => s + m.x, 0) / members.length;
        const cy = members.reduce((s: number, m: any) => s + m.y, 0) / members.length;
        const spread = Math.max(60, Math.sqrt(members.reduce((s: number, m: any) => Math.max(s, (m.x - cx) ** 2 + (m.y - cy) ** 2), 0)) + 40);
        ctx.beginPath();
        ctx.arc(cx, cy, spread, 0, Math.PI * 2);
        ctx.fillStyle = (members[0].color || '#484f58') + '15';
        ctx.fill();
        ctx.strokeStyle = (members[0].color || '#484f58') + '25';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── Collapsed cluster indicators ──
      // We need to know which clusters are collapsed and their previous centers.
      // Store cluster centers in a ref when not collapsed, so collapsed ones still show.
      // For now: collapsed clusters won't have any visible nodes, so they won't render.
      // We need to keep track of collapsed cluster centers separately.
      // This info comes from page.tsx tracking. For now, collapsed clusters = hidden.

      // Highlight set
      const highlightSet = new Set<string>();
      if (hovered || selected) {
        const focusId = (hovered || selected) as string;
        highlightSet.add(focusId);
        for (const e of eds) {
          const src = typeof e.source === 'object' ? e.source.id : e.source;
          const tgt = typeof e.target === 'object' ? e.target.id : e.target;
          if (src === focusId) highlightSet.add(tgt);
          if (tgt === focusId) highlightSet.add(src);
        }
      }
      const isFocused = highlightSet.size > 0;
      const focusedId = hovered || selected;

      // Edges
      for (const e of eds) {
        const src = typeof e.source === 'object' ? e.source : nodeMap.get(e.source);
        const tgt = typeof e.target === 'object' ? e.target : nodeMap.get(e.target);
        if (!src || !tgt || src.x == null || tgt.x == null) continue;
        if (Math.abs(src.x) > 5000 || Math.abs(tgt.x) > 5000) continue;

        const isHighlighted = !isFocused || (highlightSet.has(src.id) && highlightSet.has(tgt.id));
        const edgeAlpha = isHighlighted ? 0.6 : 0.08;
        const rTgt = Math.max(4, (tgt.val || 1) * 2.5);

        const dx = tgt.x - src.x, dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue;
        const ux = dx / dist, uy = dy / dist;
        const tipX = tgt.x - ux * (rTgt + 2), tipY = tgt.y - uy * (rTgt + 2);

        ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = e.color || '#30363d';
        ctx.globalAlpha = edgeAlpha;
        ctx.lineWidth = isHighlighted ? 1.2 : 0.5;
        ctx.stroke();

        if (dist > 20) {
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * 6 - uy * 3, tipY - uy * 6 + ux * 3);
          ctx.lineTo(tipX - ux * 6 + uy * 3, tipY - uy * 6 - ux * 3);
          ctx.closePath();
          ctx.fillStyle = e.color || '#30363d';
          ctx.globalAlpha = edgeAlpha;
          ctx.fill();
        }
        if (e.label && isHighlighted && cam.zoom > 0.5) {
          ctx.font = '7px monospace'; ctx.fillStyle = '#8b949e';
          ctx.globalAlpha = edgeAlpha * 0.8; ctx.textAlign = 'center';
          ctx.fillText(e.label, (src.x + tgt.x) / 2, (src.y + tgt.y) / 2 - 6);
        }
      }
      ctx.globalAlpha = 1;

      // Filter out collapsed + offscreen nodes for drawing
      const visibleNodes = nds.filter((n: any) => {
        if (n.cluster && collapsed.has(n.cluster)) return false;
        if (Math.abs(n.x || 0) > 5000) return false;
        return true;
      });

      // Sort: unhighlighted first, highlighted last
      const sorted = [...visibleNodes].sort((a: any, b: any) => {
        const aF = focusedId === a.id || highlightSet.has(a.id);
        const bF = focusedId === b.id || highlightSet.has(b.id);
        return (aF ? 1 : 0) - (bF ? 1 : 0);
      });

      interface PlacedLabel { x: number; y: number; w: number; }
      const placedLabels: PlacedLabel[] = [];

      for (const n of sorted) {
        if (n.x == null) continue;
        const r = Math.max(5, (n.val || 1) * 2.5);
        const isHover = hovered === n.id;
        const isSelected = selected === n.id;
        const isHighlighted = !isFocused || highlightSet.has(n.id) || n.id === focusedId;
        const nodeAlpha = isHighlighted ? 1 : 0.12;
        const labelAlpha = isHighlighted ? 1 : 0.15;

        // Exploded indicator: ring around the center node
        if (exploded && n.id === exploded) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#f0883e';
          ctx.lineWidth = 3;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          // "⬤ EXPLODED" label
          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#f0883e';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText('⬤ EXPLODED', n.x, n.y - r - 6);
        }

        if (isHover || isSelected) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
          ctx.fillStyle = n.color + (isSelected ? '77' : '44');
          ctx.fill();
        }

        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color; ctx.globalAlpha = nodeAlpha; ctx.fill();
        ctx.strokeStyle = isHighlighted ? (isSelected ? '#fff' : '#ffffff44') : 'transparent';
        ctx.lineWidth = isSelected ? 2.5 : 1; ctx.stroke();
        ctx.globalAlpha = 1;

        // Label
        if (cam.zoom > 0.4 || isSelected) {
          const labelName = n.name.length > 22 ? n.name.slice(0, 19) + '…' : n.name;
          const fontSize = isSelected ? 12 : (isHover ? 11 : 10);
          ctx.font = `${fontSize}px -apple-system, sans-serif`;
          const textW = ctx.measureText(labelName).width;
          const textH = fontSize + 2;
          const textX = n.x;
          let textY = n.y + r + textH;

          for (let attempt = 0; attempt < 5; attempt++) {
            let collision = false;
            for (const pl of placedLabels) {
              if (Math.abs(textX - pl.x) < (textW + pl.w) / 2 + 4 && Math.abs(textY - pl.y) < textH + 2) {
                collision = true; textY = pl.y + textH + 2; break;
              }
            }
            if (!collision) break;
          }
          placedLabels.push({ x: textX, y: textY, w: textW });

          ctx.globalAlpha = labelAlpha;
          ctx.fillStyle = isSelected ? '#ffffff' : '#e6edf3';
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(labelName, textX, textY);
          ctx.globalAlpha = 1;
        }

        // Count indicator for grouped nodes
        if (n.val > 12 && !isHover && !isSelected && cam.zoom > 0.5) {
          const countLabel = `×${Math.round((n.val - 6) / 0.5)}`;
          ctx.font = '8px monospace';
          ctx.fillStyle = '#8b949e';
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(countLabel, n.x + r + 2, n.y - r + 10);
        }
      }

      // ── Tooltip ──
      if (tooltipRef.current && cam.zoom > 0.3) {
        const tt = tooltipRef.current;
        ctx.font = '11px -apple-system, sans-serif';
        const lines = [
          tt.node.name,
          `${tt.node.type}${tt.node.cluster ? `  ·  ${tt.node.cluster}` : ''}`,
          tt.node.id === explodedRef.current ? 'Double-click to implode' : 'Double-click to explode',
        ];
        let maxW = 0;
        for (const line of lines) { maxW = Math.max(maxW, ctx.measureText(line).width); }
        const boxW = maxW + 16, boxH = lines.length * 16 + 12;
        const bx = tt.x + 12, by = tt.y - boxH - 8;

        ctx.save();
        ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
        ctx.fillStyle = '#161b22';
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(bx + 6, by); ctx.lineTo(bx + boxW - 6, by);
        ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + 6);
        ctx.lineTo(bx + boxW, by + boxH - 6);
        ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - 6, by + boxH);
        ctx.lineTo(bx + 6, by + boxH);
        ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - 6);
        ctx.lineTo(bx, by + 6);
        ctx.quadraticCurveTo(bx, by, bx + 6, by);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 11px -apple-system, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(lines[0], bx + 8, by + 6);
        ctx.fillStyle = '#8b949e'; ctx.font = '10px -apple-system, sans-serif';
        ctx.fillText(lines[1], bx + 8, by + 22);
        ctx.fillStyle = '#f0883e33'; ctx.font = '9px -apple-system, sans-serif';
        ctx.fillText(lines[2], bx + 8, by + 36);
        ctx.restore();
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(animRef.current); ro.disconnect(); };
  }, []);

  // ── Mouse handlers ──
  const getCanvasPos = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - cam.x) / cam.zoom,
      y: (clientY - rect.top - rect.height / 2 - cam.y) / cam.zoom,
    };
  }, []);

  // Hit test: nodes first, then cluster hulls
  const hitTest = useCallback((px: number, py: number): { type: 'node'; node: any } | { type: 'cluster'; name: string; cx: number; cy: number } | null => {
    const nds = nodesRef.current;
    // Nodes (reverse order for topmost)
    for (let i = nds.length - 1; i >= 0; i--) {
      const n = nds[i];
      if (n.cluster && collapsedRef.current.has(n.cluster)) continue;
      if (Math.abs(n.x || 0) > 5000) continue;
      const r = Math.max(5, (n.val || 1) * 2.5);
      const dx = px - n.x, dy = py - n.y;
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return { type: 'node', node: n };
    }
    // Cluster hulls
    const collapsed = collapsedRef.current;
    const clusterMap = new Map<string, any[]>();
    for (const n of nds) {
      if (!n.cluster || n.x == null || Math.abs(n.x) > 5000) continue;
      if (!clusterMap.has(n.cluster)) clusterMap.set(n.cluster, []);
      clusterMap.get(n.cluster)!.push(n);
    }
    for (const [name, members] of clusterMap) {
      if (members.length < 2) continue;
      const cx = members.reduce((s: number, m: any) => s + m.x, 0) / members.length;
      const cy = members.reduce((s: number, m: any) => s + m.y, 0) / members.length;
      const spread = Math.max(60, Math.sqrt(members.reduce((s: number, m: any) => Math.max(s, (m.x - cx) ** 2 + (m.y - cy) ** 2), 0)) + 40);
      const dx = px - cx, dy = py - cy;
      if (dx * dx + dy * dy <= spread * spread) {
        return { type: 'cluster', name, cx, cy };
      }
    }
    return null;
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    const hit = hitTest(pos.x, pos.y);
    if (hit?.type === 'node') {
      const n = hit.node;
      dragRef.current = { node: n, sx: e.clientX, sy: e.clientY, moved: false };
      n.fx = n.x; n.fy = n.y;
      // Detect double-click
      const now = Date.now();
      if (now - lastClickRef.current < 350) {
        // Double-click on node → explode/implode
        if (explodedRef.current === n.id) {
          callbacksRef.current.onExplodeToggle(null);
        } else {
          callbacksRef.current.onExplodeToggle(n.id);
        }
        dragRef.current.moved = true; // prevent single-click action
      }
      lastClickRef.current = now;
    } else if (hit?.type === 'cluster') {
      callbacksRef.current.onClusterToggle(hit.name);
    } else {
      const cam = cameraRef.current;
      panRef.current = { active: true, sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    }
  }, [getCanvasPos, hitTest]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    const drag = dragRef.current;

    if (drag.node) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      const newPos = getCanvasPos(e.clientX, e.clientY);
      drag.node.fx = newPos.x; drag.node.fy = newPos.y;
      drag.node.x = newPos.x; drag.node.y = newPos.y;
      if (simRef.current) simRef.current.alpha(0.1);
      tooltipRef.current = null;
      return;
    }
    const pan = panRef.current;
    if (pan.active) {
      const cam = cameraRef.current;
      cam.x = pan.cx + (e.clientX - pan.sx);
      cam.y = pan.cy + (e.clientY - pan.sy);
      tooltipRef.current = null;
      return;
    }

    const hit = hitTest(pos.x, pos.y);
    const hovered = hit?.type === 'node' ? hit.node.id : null;
    hoverRef.current = hovered;
    canvasRef.current!.style.cursor = hit ? 'pointer' : 'grab';

    if (hit?.type === 'node') {
      const rect = canvasRef.current!.getBoundingClientRect();
      tooltipRef.current = { node: hit.node, x: e.clientX - rect.left, y: e.clientY - rect.top };
    } else {
      tooltipRef.current = null;
    }
  }, [getCanvasPos, hitTest]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (drag.node && !drag.moved && !explodedRef.current) {
      // Single click = select (if not a double-click that was handled in onMouseDown)
      callbacksRef.current.onNodeClick(drag.node);
    }
    if (drag.node && drag.moved) {
      setTimeout(() => { drag.node.fx = null; drag.node.fy = null; if (simRef.current) simRef.current.alpha(0.1); }, 300);
    }
    dragRef.current = { node: null, sx: 0, sy: 0, moved: false };
    panRef.current = { active: false, sx: 0, sy: 0, cx: 0, cy: 0 };
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const cam = cameraRef.current;
    cam.zoom = Math.max(0.1, Math.min(5, cam.zoom * (1 + -e.deltaY * 0.001)));
    tooltipRef.current = null;
  }, []);

  const onContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (explodedRef.current) {
      callbacksRef.current.onExplodeToggle(null);
    } else {
      callbacksRef.current.onBackgroundClick();
    }
  }, []);

  const fitToNodes = useCallback(() => {
    const nds = nodesRef.current; const canvas = canvasRef.current;
    const visible = nds.filter((n: any) => !(Math.abs(n.x || 0) > 5000));
    if (!visible.length || !canvas) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of visible) {
      if (n.x == null) continue;
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    const rangeX = maxX - minX + 100, rangeY = maxY - minY + 100;
    const cw = canvas.width / devicePixelRatio, ch = canvas.height / devicePixelRatio;
    cameraRef.current.zoom = Math.max(0.2, Math.min(cw / rangeX, ch / rangeY, 2));
    cameraRef.current.x = 0; cameraRef.current.y = 0;
    tooltipRef.current = null;
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas ref={canvasRef}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onWheel={onWheel} onContextMenu={onContext}
        style={{ display: 'block', cursor: 'grab', width: '100%', height: '100%' }}
      />
      <button className="btn" style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10, fontSize: 11, padding: '4px 10px' }}
        onClick={fitToNodes}>Fit</button>
    </div>
  );
}
