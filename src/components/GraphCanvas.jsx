import React, { useEffect, useRef, useState } from 'react'

// точки пятиугольника в мировых единицах (вершины уже посчитаны в сетке)
function polyPoints(pts) {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

// зум вокруг точки (cx, cy) в координатах viewBox
function zoomAt(view, factor, cx, cy, min = 0.12, max = 4) {
  const k = Math.min(max, Math.max(min, view.k * factor))
  const real = k / view.k
  return {
    k,
    x: cx - (cx - view.x) * real,
    y: cy - (cy - view.y) * real,
  }
}

const MIN_MOVE = 0.5 // px, порог "это было перетаскивание, а не клик"

export default function GraphCanvas({
  nodes,
  edges,
  cellR,
  startId,
  endId,
  phase, // 'idle' | 'scan' | 'result'
  plan,
  wave,
  scanStep = 0.12, // с задержки на один уровень волны
  scanFlash = 1.0, // с длительность вспышки элемента
  view,
  onViewChange,
  onSize,
  onNodeClick,
}) {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const viewRef = useRef(view)
  viewRef.current = view
  const sizeRef = useRef(size)
  sizeRef.current = size

  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  const movedRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const strokeBase = cellR * 0.055
  const strokeScan = cellR * 0.08
  const strokePath = cellR * 0.1

  /* --------- измерение контейнера --------- */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.w > 0 && size.h > 0) onSize?.(size)
  }, [size, onSize])

  /* --------- колесо мыши: зум к курсору --------- */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      if (!viewRef.current) return
      const rect = el.getBoundingClientRect()
      const cx = ((e.clientX - rect.left) / rect.width) * sizeRef.current.w
      const cy = ((e.clientY - rect.top) / rect.height) * sizeRef.current.h
      const factor = Math.exp(-e.deltaY * 0.0015)
      onViewChange((v) => zoomAt(v, factor, cx, cy))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onViewChange])

  /* --------- перетаскивание / пинч --------- */
  const toSvg = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * sizeRef.current.w,
      y: ((e.clientY - rect.top) / rect.height) * sizeRef.current.h,
    }
  }

  const handlePointerDown = (e) => {
    pointersRef.current.set(e.pointerId, toSvg(e))
    movedRef.current = false
    setDragging(true)
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
    }
  }

  useEffect(() => {
    if (!dragging) return

    const onMove = (e) => {
      if (!pointersRef.current.has(e.pointerId)) return
      const prev = pointersRef.current.get(e.pointerId)
      const p = toSvg(e)
      pointersRef.current.set(e.pointerId, p)

      if (Math.hypot(p.x - prev.x, p.y - prev.y) > MIN_MOVE) {
        movedRef.current = true
      }

      if (pointersRef.current.size === 1) {
        onViewChange((v) => ({
          ...v,
          x: v.x + (p.x - prev.x),
          y: v.y + (p.y - prev.y),
        }))
      } else if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const prevPinch = pinchRef.current
        if (prevPinch) {
          onViewChange((v) => {
            const nv = zoomAt(v, dist / prevPinch.dist, prevPinch.mid.x, prevPinch.mid.y)
            return {
              ...nv,
              x: nv.x + (mid.x - prevPinch.mid.x),
              y: nv.y + (mid.y - prevPinch.mid.y),
            }
          })
        }
        pinchRef.current = { dist, mid }
      }
    }

    const onUp = (e) => {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      if (pointersRef.current.size === 0) setDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, onViewChange])

  const handleNodeClick = (id) => {
    if (movedRef.current) return // это было перетаскивание поля
    onNodeClick(id)
  }

  /* --------- стили рёбер --------- */
  const pathEdges = plan?.edgeIds ?? new Set()
  const pathNodes = plan?.nodeSet ?? new Set()

  const edgeClass = (e) => {
    if (phase === 'scan') return 'edge edge-scan'
    if (phase === 'result')
      return pathEdges.has(e.id) ? 'edge edge-path' : 'edge edge-dim'
    return e.weight != null ? 'edge edge-idle has-weight' : 'edge edge-idle'
  }

  const edgeStyle = (e) => {
    if (phase === 'scan') {
      const lvl = wave?.edgeLevel?.[e.id]
      return {
        strokeWidth: strokeScan,
        animationDelay: `${((Number.isFinite(lvl) ? lvl : 0) * scanStep).toFixed(2)}s`,
        animationDuration: `${scanFlash}s`,
      }
    }
    if (phase === 'result' && pathEdges.has(e.id)) {
      const a = cellR * 0.18
      const b = cellR * 0.14
      return {
        strokeWidth: strokePath,
        '--dash': `${a.toFixed(1)} ${b.toFixed(1)}`,
        '--shift': `${(-(a + b)).toFixed(1)}`,
      }
    }
    return { strokeWidth: strokeBase }
  }

  const labelClass = (e) => {
    if (phase === 'result') {
      return pathEdges.has(e.id)
        ? 'edge-label edge-label-path'
        : 'edge-label edge-label-dim'
    }
    return 'edge-label'
  }

  const nodeById = (id) => nodes.find((n) => n.id === id)

  return (
    <div
      ref={wrapRef}
      className="h-full w-full"
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${Math.max(size.w, 1)} ${Math.max(size.h, 1)}`}
        className="h-full w-full select-none"
        onPointerDown={handlePointerDown}
      >
        {view && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/* линии путей */}
            <g className="edges">
              {edges
                .filter((e) => e.active)
                .map((e) => {
                  const a = nodeById(e.a)
                  const b = nodeById(e.b)
                  return (
                    <line
                      key={e.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={edgeClass(e)}
                      style={edgeStyle(e)}
                    />
                  )
                })}
            </g>

            {/* точки-пятиугольники */}
            <g className="nodes">
              {nodes.map((n) => {
                const isStart = n.id === startId
                const isEnd = n.id === endId
                const onPath = pathNodes.has(n.id)
                const dimmed = phase === 'result' && !onPath

                // найденный путь подсвечиваем только после волны (фаза result),
                // во время сканирования все точки участвуют в волне
                let cls = 'hex-cell hex-base'
                if (onPath && phase === 'result') cls = 'hex-cell hex-onpath'
                else if (isStart) cls = 'hex-cell hex-selected'
                else if (isEnd) cls = 'hex-cell hex-end'
                if (dimmed) cls += ' hex-dim'

                const pulsing = (isStart || isEnd) && phase !== 'idle'
                const scanning = phase === 'scan' && !isStart && !isEnd
                if (scanning) cls += ' hex-scan'
                const pulseColor = isStart ? '#22d3ee' : '#f472b6'

                const nodeStyle = { color: pulseColor, cursor: 'pointer' }
                if (scanning) {
                  const lvl = wave?.nodeLevel?.get(n.id)
                  nodeStyle.animationDelay = `${((Number.isFinite(lvl) ? lvl : 0) * scanStep).toFixed(2)}s`
                  nodeStyle.animationDuration = `${scanFlash}s`
                }

                return (
                  <g
                    key={n.id}
                    onClick={() => handleNodeClick(n.id)}
                    style={nodeStyle}
                  >
                    <polygon
                      points={polyPoints(n.pts)}
                      className={`${cls}${pulsing ? ' node-pulse' : ''}`}
                      strokeWidth={cellR * 0.05}
                    />
                    <text
                      x={n.x}
                      y={n.y + cellR * 0.02}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="node-label"
                      fontSize={cellR * 0.62}
                      fill={dimmed ? '#64748b' : '#e2e8f0'}
                    >
                      {n.id}
                    </text>
                  </g>
                )
              })}
            </g>

            {/* числа (время в пути) — поверх плиток, чтобы не прятались
                под заливкой соседних пятиугольников */}
            <g className="edge-labels">
              {edges
                .filter((e) => e.active && e.weight != null)
                .map((e) => {
                  const a = nodeById(e.a)
                  const b = nodeById(e.b)
                  return (
                    <text
                      key={e.id}
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className={labelClass(e)}
                      fontSize={cellR * 0.38}
                      fill="#7dd3fc"
                    >
                      {e.weight}
                    </text>
                  )
                })}
            </g>
          </g>
        )}
      </svg>
    </div>
  )
}
