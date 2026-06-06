'use client';

import { useEffect, useRef, useCallback } from 'react';

interface GraphNode {
  id: string;
  name: string;
  val: number;
  color: string;
  type: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string;
  color?: string;
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId: string | null;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
}

/**
 * Canvas-based interactive force-directed graph.
 * Uses d3-force for simulation, manual Canvas rendering.
 * No dependencies on react-force-graph (avoids Three.js bloat).
 */
export default function ForceGraph2D({ nodes, links, selectedId, onNodeClick, onBackgroundClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<any>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<any[]>([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef({ node: null as any, sx: 0, sy: 0, nx: 0, ny: 0, moved: false });
  const panRef = useRef({ active: false, sx: 0, sy: 0, cx: 0, cy: 0 });
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onNodeClick, onBackgroundClick });

  // Keep callbacks fresh
  useEffect(() => { callbacksRef.current = { onNodeClick, onBackgroundClick }; }, [onNodeClick, onBackgroundClick]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  // ── Initialize simulation when data changes ──
  useEffect(() => {
    // Import d3-force dynamically
    let cancelled = false;

    async function init() {
      const d3 = await import('d3-force');
      if (cancelled) return;

      // Deep clone nodes/links so we can mutate positions
      const simNodes: GraphNode[] = nodes.map(n => ({ ...n, x: Math.random() * 400 - 200, y: Math.random() * 400 - 200 }));
      const simLinks = links.map(l => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
        label: l.label,
        color: l.color,
      }));

      nodesRef.current = simNodes;
      linksRef.current = simLinks;

      // Build force simulation
      const sim = d3.forceSimulation(simNodes)
        .force('link', d3.forceLink(simLinks).id((d: any) => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-150))
        .force('center', d3.forceCenter(0, 0))
        .force('collision', d3.forceCollide().radius((d: any) => Math.max(5, (d.val || 1) * 4)))
        .alphaDecay(0.02);

      simRef.current = sim;

      // Fit camera to nodes after a short settle
      setTimeout(() => fitToNodes(), 500);
    }

    init();
    return () => { cancelled = true; };
  }, [nodes, links]);

  // ── Render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      if (!canvas || !canvas.parentElement || !ctx) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth * devicePixelRatio;
      canvas.height = parent.clientHeight * devicePixelRatio;
      canvas.style.width = parent.clientWidth + 'px';
      canvas.style.height = parent.clientHeight + 'px';
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    function render() {
      const w = canvas!.width / devicePixelRatio;
      const h = canvas!.height / devicePixelRatio;
      const cam = cameraRef.current;

      ctx!.clearRect(0, 0, w, h);

      ctx!.save();
      ctx!.translate(w / 2 + cam.x, h / 2 + cam.y);
      ctx!.scale(cam.zoom, cam.zoom);

      const nodes = nodesRef.current;
      const links = linksRef.current;

      // Build node lookup
      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      // Draw links
      for (const l of links) {
        const src = typeof l.source === 'object' ? l.source : nodeMap.get(l.source);
        const tgt = typeof l.target === 'object' ? l.target : nodeMap.get(l.target);
        if (!src || !tgt) continue;

        ctx!.beginPath();
        ctx!.moveTo(src.x!, src.y!);
        ctx!.lineTo(tgt.x!, tgt.y!);
        ctx!.strokeStyle = l.color || '#30363d';
        ctx!.lineWidth = 0.8;
        ctx!.stroke();

        // Label midpoint
        if (l.label && cam.zoom > 0.6) {
          const mx = (src.x! + tgt.x!) / 2;
          const my = (src.y! + tgt.y!) / 2;
          ctx!.font = '8px monospace';
          ctx!.fillStyle = '#8b949e';
          ctx!.textAlign = 'center';
          ctx!.fillText(l.label, mx, my - 4);
        }
      }

      // Draw nodes
      for (const n of nodes) {
        const r = Math.max(4, (n.val || 1) * 3);
        const isHover = hoverRef.current === n.id;
        const isSelected = selectedRef.current === n.id;

        // Glow for selected
        if (isSelected) {
          ctx!.beginPath();
          ctx!.arc(n.x!, n.y!, r + 4, 0, Math.PI * 2);
          ctx!.fillStyle = n.color + '66';
          ctx!.fill();
        }

        // Node circle
        ctx!.beginPath();
        ctx!.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx!.fillStyle = n.color;
        ctx!.fill();

        if (isHover || isSelected) {
          ctx!.strokeStyle = '#fff';
          ctx!.lineWidth = 2;
          ctx!.stroke();
        }

        // Label
        if (cam.zoom > 0.5 || isSelected) {
          const fontSize = isSelected ? 11 : (isHover ? 10 : 9);
          ctx!.font = `${fontSize}px -apple-system, sans-serif`;
          ctx!.fillStyle = isSelected ? '#fff' : '#c9d1d9';
          ctx!.textAlign = 'center';
          ctx!.fillText(n.name, n.x!, n.y! + r + fontSize + 1);
        }
      }

      ctx!.restore();
      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []);

  // ── Mouse handlers ──
  const getPos = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      x: (e.clientX - rect.left - rect.width / 2 - cam.x) / cam.zoom,
      y: (e.clientY - rect.top - rect.height / 2 - cam.y) / cam.zoom,
    };
  }, []);

  const hitTest = useCallback((px: number, py: number) => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = Math.max(4, (n.val || 1) * 3);
      const dx = px - n.x!;
      const dy = py - n.y!;
      if (dx * dx + dy * dy <= r * r + 8) return n;
    }
    return null;
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit) {
      dragRef.current = { node: hit, sx: e.clientX, sy: e.clientY, nx: hit.x!, ny: hit.y!, moved: false };
      // Pin the node
      hit.fx = hit.x;
      hit.fy = hit.y;
    } else {
      panRef.current = { active: true, sx: e.clientX, sy: e.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y };
    }
  }, [getPos, hitTest]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getPos(e);

    // Drag
    const drag = dragRef.current;
    if (drag.node) {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      const newPos = getPos(e);
      drag.node.fx = newPos.x;
      drag.node.fy = newPos.y;
      drag.node.x = newPos.x;
      drag.node.y = newPos.y;
      // Resume simulation slightly
      if (simRef.current) simRef.current.alpha(0.1);
      return;
    }

    // Pan
    const pan = panRef.current;
    if (pan.active) {
      cameraRef.current.x = pan.cx + (e.clientX - pan.sx);
      cameraRef.current.y = pan.cy + (e.clientY - pan.sy);
      return;
    }

    // Hover
    const hit = hitTest(pos.x, pos.y);
    hoverRef.current = hit?.id || null;
    canvasRef.current!.style.cursor = hit ? 'pointer' : 'grab';
  }, [getPos, hitTest]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (drag.node) {
      if (!drag.moved) {
        // Click — not drag
        callbacksRef.current.onNodeClick(drag.node);
      } else {
        // Unpin after drag so simulation can settle
        setTimeout(() => {
          if (drag.node) {
            drag.node.fx = null;
            drag.node.fy = null;
            if (simRef.current) simRef.current.alpha(0.1);
          }
        }, 500);
      }
      dragRef.current = { node: null, sx: 0, sy: 0, nx: 0, ny: 0, moved: false };
    }
    panRef.current = { active: false, sx: 0, sy: 0, cx: 0, cy: 0 };
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const delta = -e.deltaY * 0.001;
    cam.zoom = Math.max(0.1, Math.min(5, cam.zoom * (1 + delta)));
  }, []);

  // ── Context menu ──
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    callbacksRef.current.onBackgroundClick();
  }, []);

  // ── Fit to nodes ──
  const fitToNodes = useCallback(() => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const margin = 60;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x! < minX) minX = n.x!;
      if (n.x! > maxX) maxX = n.x!;
      if (n.y! < minY) minY = n.y!;
      if (n.y! > maxY) maxY = n.y!;
    }
    const rangeX = maxX - minX + margin * 2;
    const rangeY = maxY - minY + margin * 2;
    const cw = canvas.width / devicePixelRatio;
    const ch = canvas.height / devicePixelRatio;
    const zoom = Math.min(cw / rangeX, ch / rangeY, 2);
    cameraRef.current.zoom = Math.max(0.3, zoom);
    cameraRef.current.x = 0;
    cameraRef.current.y = 0;
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
        style={{ display: 'block', cursor: 'grab', width: '100%', height: '100%' }}
      />
      {/* Fit button */}
      <button
        className="btn"
        style={{ position: 'absolute', bottom: 48, right: 16, zIndex: 10, fontSize: 11, padding: '4px 10px' }}
        onClick={fitToNodes}
      >
        Fit view
      </button>
    </div>
  );
}
