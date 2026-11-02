import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildPentGrid } from './lib/pentGrid.js'
import { randomizeWeights, pruneEdges, aStar, bfsLevels } from './lib/graph.js'
import GraphCanvas from './components/GraphCanvas.jsx'

// масштаб, при котором сетка целиком помещается в поле с запасом
function fitView(bounds, w, h, margin = 0.16) {
  const bw = Math.max(bounds.maxX - bounds.minX, 1)
  const bh = Math.max(bounds.maxY - bounds.minY, 1)
  const k = Math.min((w * (1 - margin * 2)) / bw, (h * (1 - margin * 2)) / bh)
  return { x: w / 2, y: h / 2, k }
}

// параметры анимации волны сканирования (замедлены для плавности)
const SCAN_STEP = 0.3 // с задержки на один уровень волны
const SCAN_FLASH = 2.0 // с длительность вспышки одного элемента

// разбег случайных расстояний между точками (берётся по логарифму,
// см. randomizeWeights — тяжёлый хвост даёт длинные дуги)
const W_MIN = 1
const W_MAX = 999

// Волна навстречу: уровень = минимум из расстояний до старта и до финиша,
// поэтому подсветка расходится от двух точек и встречается в середине.
function mergeWaves(a, b) {
  const nodeLevel = new Map()
  for (const [id, la] of a.nodeLevel) {
    const lb = b.nodeLevel.has(id) ? b.nodeLevel.get(id) : Infinity
    nodeLevel.set(id, Math.min(la, lb))
  }
  const edgeLevel = {}
  for (const id in a.edgeLevel) {
    const lb = b.edgeLevel[id] ?? Infinity
    edgeLevel[id] = Math.min(a.edgeLevel[id], lb)
  }
  return { nodeLevel, edgeLevel }
}

// самый дальний достигнутый уровень — по нему считаем длительность волны
function maxFiniteLevel(wave) {
  let max = 0
  for (const lvl of wave.nodeLevel.values()) {
    if (Number.isFinite(lvl) && lvl > max) max = lvl
  }
  return max
}

export default function App() {
  const { nodes, edges: baseEdges, cellR, bounds } = useMemo(
    () => buildPentGrid(),
    [],
  )

  const [edges, setEdges] = useState(baseEdges)
  const [startId, setStartId] = useState('')
  const [endId, setEndId] = useState('')
  const [phase, setPhase] = useState('idle') // idle | scan | result
  const [plan, setPlan] = useState(null)
  const [wave, setWave] = useState(null)

  const [size, setSize] = useState(null)
  const [view, setView] = useState(null)
  const timerRef = useRef(null)

  const resetSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPhase('idle')
    setPlan(null)
    setWave(null)
  }, [])

  // таймлайн: сканирование -> результат.
  // Длительность = последний уровень волны * шаг + вспышка, поэтому путь
  // подсвечивается только после того, как импульс пройдёт всё поле.
  useEffect(() => {
    if (phase !== 'scan' || !wave) return
    const duration = (maxFiniteLevel(wave) * SCAN_STEP + SCAN_FLASH) * 1000
    timerRef.current = setTimeout(() => setPhase('result'), duration)
    return () => clearTimeout(timerRef.current)
  }, [phase, wave])

  // первичная подгонка масштаба под поле
  const handleSize = useCallback((s) => {
    setSize((prev) =>
      prev && prev.w === s.w && prev.h === s.h ? prev : s,
    )
  }, [])

  useEffect(() => {
    if (size && !view) setView(fitView(bounds, size.w, size.h))
  }, [size, view, bounds])

  /* ---------------------- действия ---------------------- */

  const handleSetDistance = () => {
    setEdges((prev) => randomizeWeights(prev, W_MIN, W_MAX))
    resetSearch()
  }

  const handlePrune = () => {
    // каждый раз обрубаем заново от полного графа, но переносим уже
    // заданные расстояния (иначе веса терялись бы при обрубании)
    const prevWeights = new Map(edges.map((e) => [e.id, e.weight]))
    const full = baseEdges.map((e) => ({
      ...e,
      weight: prevWeights.get(e.id) ?? null,
    }))
    setEdges(pruneEdges(nodes, full))
    resetSearch()
  }

  const handleSearch = () => {
    if (!startId || !endId) return

    let working = edges
    if (edges.some((e) => e.active && e.weight == null)) {
      working = randomizeWeights(edges, W_MIN, W_MAX)
      setEdges(working)
    }

    const result = aStar(nodes, working, startId, endId)
    setPlan(result)
    // волна идёт навстречу: одновременно от старта и от финиша
    setWave(
      mergeWaves(
        bfsLevels(nodes, working, startId),
        bfsLevels(nodes, working, endId),
      ),
    )
    setPhase(result?.found ? 'scan' : 'result')
  }

  const handleNodeClick = (id) => {
    if (!startId || (startId && endId)) {
      setStartId(id)
      setEndId('')
    } else if (id !== startId) {
      setEndId(id)
    }
    resetSearch()
  }

  // сброс: убрать выбор точек и вернуть полный граф (камеру не трогаем)
  const handleReset = () => {
    setStartId('')
    setEndId('')
    setEdges(baseEdges)
    resetSearch()
  }

  const ready = Boolean(startId && endId)
  const status = plan?.found
    ? `${plan.path.join(' → ')}  •  ${plan.cost}`
    : ready
      ? 'Готово к поиску'
      : 'Кликните две точки: старт и финиш'

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        cellR={cellR}
        startId={startId}
        endId={endId}
        phase={phase}
        plan={plan}
        wave={wave}
        scanStep={SCAN_STEP}
        scanFlash={SCAN_FLASH}
        view={view}
        onViewChange={setView}
        onSize={handleSize}
        onNodeClick={handleNodeClick}
      />

      {/* плавающая панель управления */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center p-4 md:p-6">
        <aside className="pointer-events-auto flex w-[248px] flex-col gap-3 rounded-3xl border border-slate-700/50 bg-slate-950/70 p-5">
          <div className="flex flex-col gap-3">
            <NeonButton tone="cyan" onClick={handleSetDistance}>
              Задать расстояние
            </NeonButton>
            <NeonButton tone="magenta" onClick={handlePrune}>
              Обрубить пути
            </NeonButton>
            <NeonButton tone="green" onClick={handleSearch} disabled={!ready}>
              Искать
            </NeonButton>
            <NeonButton tone="amber" onClick={handleReset}>
              Сброс
            </NeonButton>
          </div>

          {plan?.found && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2 text-center text-[11px] leading-snug text-slate-400">
              {status}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function NeonButton({ children, onClick, tone = 'cyan', disabled }) {
  const tones = {
    cyan: 'border-cyan-400/60 text-cyan-300 hover:bg-cyan-400/10 hover:shadow-[0_0_25px_-2px_#22d3ee]',
    magenta:
      'border-pink-400/60 text-pink-300 hover:bg-pink-400/10 hover:shadow-[0_0_25px_-2px_#f472b6]',
    green:
      'border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10 hover:shadow-[0_0_25px_-2px_#34d399]',
    amber:
      'border-amber-400/60 text-amber-300 hover:bg-amber-400/10 hover:shadow-[0_0_25px_-2px_#fbbf24]',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border bg-slate-900/40 px-4 py-3 text-sm font-semibold uppercase tracking-wider transition-all duration-300 ${tones[tone]} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none`}
    >
      {children}
    </button>
  )
}
