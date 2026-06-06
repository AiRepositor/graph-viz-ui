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
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  repo: '#0f3460', skill: '#2d6a4f', profile: '#6a2d2d', config: '#6a6a2d',
  cron: '#2d4a6a', plugin: '#6a2d6a', tool: '#2d6a6a', session: '#4a4a6a',
};

export default function ForceGraph2D({ nodes, links, selectedId, onNodeClick, onBackgroundClick }: Props) {
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
  const tooltipRef = useRef<{ node: any; x: number; y: number } | null>(null);
  const callbacksRef = useRef({ onNodeClick, onBackgroundClick });
  const initializedRef = useRef(false);

  // Keep callbacks fresh
  useEffect(() => { callbacksRef.current = { onNodeClick, onBackgroundClick }; }, [onNodeClick, onBackgroundClick]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  // ── Simulation: initialize once, hot-swap data ──
  useEffect(() => {
    async function init() {
      const d3 = await import('d3-force');

      // Clone nodes for simulation (positions survive across data swaps)
      const simNodes: any[] = nodes.map(n => ({
        ...n,
        x: n.x ?? (Math.random() - 0.5) * 200,
        y: n.y ?? (Math.random() - 0.5) * 200,
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
        .alphaDecay(0.015);

      sim.on('tick', () => { /* render loop handles this */ });
      simRef.current = sim;
      initializedRef.current = true;
    }
    init();
    return () => {
      if (simRef.current) simRef.current.stop();
      initializedRef.current = false;
    };
  }, []);

  // ── Hot-swap data without restarting simulation ──
  useEffect(() => {
    if (!simRef.current || !initializedRef.current) return;

    const sim = simRef.current;
    const currentNodes = nodesRef.current;
    const currentLinks = linksRef.current;

    // Build ID map of existing nodes to preserve positions
    const existingPositions = new Map(currentNodes.map((n: any) => [n.id, { x: n.x, y: n.y }]));

    // Create new nodes preserving positions where possible
    const newNodes: any[] = nodes.map(n => {
      const existing = existingPositions.get(n.id);
      return {
        ...n,
        x: existing?.x ?? (Math.random() - 0.5) * 200,
        y: existing?.y ?? (Math.random() - 0.5) * 200,
      };
    });

    const newLinks = links.map(l => ({
      source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
      target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
      label: l.label, color: l.color,
    }));

    nodesRef.current = newNodes;
    linksRef.current = newLinks;

    // Hot-swap in simulation
    sim.nodes(newNodes);
    sim.force('link')!.links(newLinks);
    sim.alpha(0.5).restart();

    // Auto-fit on first data load
    setTimeout(() => fitToNodes(), 300);
  }, [nodes, links]);

  // ── Canvas render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    function resize() {
      if (!canvas || !canvas.parentElement) return;
      const w = canvas.parentElement.clientWidth;
      const h = canvas.parentElement.clientHeight;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    function render() {
      if (!canvas) return;
      const W = canvas.width / devicePixelRatio;
      const H = canvas.height / devicePixelRatio;
      const cam = cameraRef.current;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 + cam.x, H / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const nds = nodesRef.current;
      const eds = linksRef.current;
      const hovered = hoverRef.current;
      const selected = selectedRef.current;

      // Node lookup
      const nodeMap = new Map(nds.map((n: any) => [n.id, n]));

      // Determine highlight set
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

      // ── Draw cluster hulls (subtle background per cluster) ──
      const clusterGroups = new Map<string, any[]>();
      for (const n of nds) {
        if (n.cluster && n.x != null && n.y != null) {
          if (!clusterGroups.has(n.cluster)) clusterGroups.set(n.cluster, []);
          clusterGroups.get(n.cluster)!.push(n);
        }
      }
      for (const [name, members] of clusterGroups) {
        if (members.length < 2) continue;
        const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
        const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
        // Spread: max distance from center
        const spread = Math.max(
          60,
          Math.sqrt(members.reduce((s, m) => Math.max(s, (m.x - cx) ** 2 + (m.y - cy) ** 2), 0)) + 40
        );
        ctx.beginPath();
        ctx.arc(cx, cy, spread, 0, Math.PI * 2);
        ctx.fillStyle = (members[0].color || '#484f58') + '15';
        ctx.fill();
        ctx.strokeStyle = (members[0].color || '#484f58') + '25';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── Draw edges ──
      for (const e of eds) {
        const src = typeof e.source === 'object' ? e.source : nodeMap.get(e.source);
        const tgt = typeof e.target === 'object' ? e.target : nodeMap.get(e.target);
        if (!src || !tgt || src.x == null || tgt.x == null) continue;

        // Dim non-highlighted edges
        const isHighlighted = !isFocused || (highlightSet.has(src.id) && highlightSet.has(tgt.id));
        const edgeAlpha = isHighlighted ? 0.6 : 0.08;
        const rTgt = Math.max(4, (tgt.val || 1) * 2.5);

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);

        // Calculate arrow endpoint (edge of target circle)
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / dist, uy = dy / dist;
        const tipX = tgt.x - ux * (rTgt + 2);
        const tipY = tgt.y - uy * (rTgt + 2);

        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = e.color || '#30363d';
        ctx.globalAlpha = edgeAlpha;
        ctx.lineWidth = isHighlighted ? 1.2 : 0.5;
        ctx.stroke();

        // Arrowhead
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

        // Edge label
        if (e.label && isHighlighted && cam.zoom > 0.5) {
          const mx = (src.x + tgt.x) / 2;
          const my = (src.y + tgt.y) / 2;
          ctx.font = '7px monospace';
          ctx.fillStyle = '#8b949e';
          ctx.globalAlpha = edgeAlpha * 0.8;
          ctx.textAlign = 'center';
          ctx.fillText(e.label, mx, my - 6);
        }
      }
      ctx.globalAlpha = 1;

      // ── Draw nodes (sorted so unhighlighted go first) ──
      const sorted = [...nds].sort((a: any, b: any) => {
        const aFocused = focusedId === a.id || highlightSet.has(a.id);
        const bFocused = focusedId === b.id || highlightSet.has(b.id);
        return (aFocused ? 1 : 0) - (bFocused ? 1 : 0);
      });

      interface PlacedLabel { x: number; y: number; w: number; }
      const placedLabels: PlacedLabel[] = [];

      for (const n of sorted) {
        if (n.x == null) continue;
        const r = Math.max(5, (n.val || 1) * 2.5);
        const isHover = hovered === n.id;
        const isSelected = selected === n.id;
        const isHighlighted = !isFocused || highlightSet.has(n.id) || n.id === focusedId;

        // Dim non-highlighted
        const nodeAlpha = isHighlighted ? 1 : 0.12;
        const labelAlpha = isHighlighted ? 1 : 0.15;

        // Glow for hovered/selected
        if (isHover || isSelected) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
          ctx.fillStyle = n.color + (isSelected ? '77' : '44');
          ctx.fill();
        }

        // Bubble
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.globalAlpha = nodeAlpha;
        ctx.fill();
        ctx.strokeStyle = isHighlighted ? (isSelected ? '#fff' : '#ffffff44') : 'transparent';
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Label with collision avoidance
        if (cam.zoom > 0.4 || isSelected) {
          const labelName = n.name.length > 22 ? n.name.slice(0, 19) + '…' : n.name;
          const fontSize = isSelected ? 12 : (isHover ? 11 : 10);
          ctx.font = `${fontSize}px -apple-system, sans-serif`;
          const metrics = ctx.measureText(labelName);
          const textW = metrics.width;
          const textH = fontSize + 2;
          const textX = n.x;
          const textY = n.y + r + textH;

          // Check collision with already-placed labels
          let finalY = textY;
          const maxAttempts = 5;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let collision = false;
            for (const pl of placedLabels) {
              if (Math.abs(textX - pl.x) < (textW + pl.w) / 2 + 4 &&
                  Math.abs(finalY - pl.y) < textH + 2) {
                collision = true;
                finalY = pl.y + textH + 2; // push down
                break;
              }
            }
            if (!collision) break;
          }

          placedLabels.push({ x: textX, y: finalY, w: textW });

          ctx.globalAlpha = labelAlpha;
          ctx.fillStyle = isSelected ? '#ffffff' : '#e6edf3';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(labelName, textX, finalY);
          ctx.globalAlpha = 1;
        }
      }

      // ── Tooltip ──
      if (tooltipRef.current && cam.zoom > 0.3) {
        const tt = tooltipRef.current;
        const ttX = (tt.x - (W / 2 + cam.x)) / cam.zoom;
        const ttY = (tt.y - (H / 2 + cam.y)) / cam.zoom;

        ctx.font = '11px -apple-system, sans-serif';
        const lines = [
          tt.node.name,
          `${tt.node.type}${tt.node.cluster ? `  ·  ${tt.node.cluster}` : ''}`,
        ];
        let maxW = 0;
        for (const line of lines) {
          maxW = Math.max(maxW, ctx.measureText(line).width);
        }
        const boxW = maxW + 16;
        const boxH = lines.length * 16 + 12;
        const screenX = tt.x + 12;
        const screenY = tt.y - boxH - 8;

        ctx.save();
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#161b22';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;

        // Round rect
        const bx = screenX, by = screenY, bw = boxW, bh = boxH, br = 6;
        ctx.beginPath();
        ctx.moveTo(bx + br, by);
        ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e6edf3';
        ctx.font = 'bold 11px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(lines[0], bx + 8, by + 6);
        ctx.fillStyle = '#8b949e';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillText(lines[1], bx + 8, by + 22);
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

  const hitTest = useCallback((px: number, py: number) => {
    const nds = nodesRef.current;
    for (let i = nds.length - 1; i >= 0; i--) {
      const n = nds[i];
      const r = Math.max(5, (n.val || 1) * 2.5);
      const dx = px - n.x, dy = py - n.y;
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return n;
    }
    return null;
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    const hit = hitTest(pos.x, pos.y);
    if (hit) {
      dragRef.current = { node: hit, sx: e.clientX, sy: e.clientY, moved: false };
      hit.fx = hit.x; hit.fy = hit.y;
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

    // Hover + tooltip
    const hit = hitTest(pos.x, pos.y);
    hoverRef.current = hit?.id || null;
    canvasRef.current!.style.cursor = hit ? 'pointer' : 'grab';

    if (hit) {
      const rect = canvasRef.current!.getBoundingClientRect();
      tooltipRef.current = {
        node: hit,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    } else {
      tooltipRef.current = null;
    }
  }, [getCanvasPos, hitTest]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (drag.node) {
      if (!drag.moved) {
        callbacksRef.current.onNodeClick(drag.node);
      } else {
        setTimeout(() => {
          drag.node.fx = null; drag.node.fy = null;
          if (simRef.current) simRef.current.alpha(0.1);
        }, 300);
      }
      dragRef.current = { node: null, sx: 0, sy: 0, moved: false };
    }
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
    callbacksRef.current.onBackgroundClick();
  }, []);

  const fitToNodes = useCallback(() => {
    const nds = nodesRef.current; const canvas = canvasRef.current;
    if (!nds.length || !canvas) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nds) {
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
