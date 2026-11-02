// Алгоритмы графа: случайные веса, безопасное обрубание путей, A*, BFS-волна.

export const randInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min

export const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)

// Строим список смежности только по активным (не обрубленным) рёбрам.
function buildAdjacency(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!e.active) continue
    const w = e.weight ?? 1
    adj.get(e.a).push({ to: e.b, w, edgeId: e.id })
    adj.get(e.b).push({ to: e.a, w, edgeId: e.id })
  }
  return adj
}

/* -------------------- 1. Случайные расстояния -------------------- */
// Расстояние берём по логарифмическому распределению (тяжёлый хвост):
// много дешёвых рёбер и редкие дорогие. Так образуются сквозные «дешёвые
// коридоры», и A* может повести путь длинной дугой даже между близкими
// точками. Линейный разбег (1..60, 1..999) такого эффекта не даёт:
// чтобы дуга из k звеньев победила прямое ребро, нужно k·(дешёвые) <
// (дорогое), а при равномерном распределении это возможно лишь при k < 2.
export function randomizeWeights(edges, min = 1, max = 60) {
  const lo = Math.log(min)
  const span = Math.log(max) - lo
  return edges.map((e) =>
    e.active
      ? { ...e, weight: Math.round(Math.exp(lo + Math.random() * span)) }
      : e,
  )
}

/* -------------------- 2. Безопасное обрубание -------------------- */
// Проходим по точкам в случайном порядке. Если к точке уже ведёт
// зафиксированный путь от ранее обработанной точки — сохраняем его.
// Из остальных доступных путей рандомно оставляем часть, лишние удаляем.
// Гарантия: ни одна точка не остаётся изолированной, а граф — связный.
export function pruneEdges(nodes, baseEdges) {
  const edges = baseEdges.map((e) => ({ ...e, active: true }))
  const incident = new Map(nodes.map((n) => [n.id, []]))
  edges.forEach((e, i) => {
    incident.get(e.a).push(i)
    incident.get(e.b).push(i)
  })

  const other = (e, id) => (e.a === id ? e.b : e.a)

  const connected = new Set()
  const decided = new Set()
  const keep = new Set()

  for (const id of shuffle(nodes.map((n) => n.id))) {
    const inc = incident.get(id)

    // зафиксированные пути: к уже подключённым точкам
    const toConnected = inc.filter(
      (i) => !decided.has(i) && connected.has(other(edges[i], id)),
    )

    if (toConnected.length > 0) {
      toConnected.forEach((i) => {
        keep.add(i)
        decided.add(i)
      })
    } else {
      // точку ещё не подключили — обязательно оставляем хотя бы один путь
      const candidates = inc.filter((i) => !decided.has(i))
      if (candidates.length > 0) {
        const pick = candidates[randInt(0, candidates.length - 1)]
        keep.add(pick)
        decided.add(pick)
      } else if (!inc.some((i) => keep.has(i)) && inc.length > 0) {
        keep.add(inc[randInt(0, inc.length - 1)])
      }
    }

    connected.add(id)

    // из оставшихся путей рандомно решаем, сколько сохранить
    const remaining = shuffle(inc.filter((i) => !decided.has(i)))
    const extraCount = randInt(0, Math.min(remaining.length, 2))
    remaining.forEach((i, k) => {
      if (k < extraCount) keep.add(i)
      decided.add(i)
    })
  }

  edges.forEach((e, i) => {
    e.active = keep.has(i)
  })

  // страховка: делаем граф связным, добавляя минимально нужные рёбра
  repairConnectivity(edges, nodes)

  return edges.filter((e) => e.active)
}

function components(ids, edges) {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x)
    return x
  }
  const union = (a, b) => parent.set(find(a), find(b))
  for (const e of edges) {
    if (e.active) union(e.a, e.b)
  }
  const map = {}
  const number = new Set()
  for (const id of ids) {
    const root = find(id)
    map[id] = root
    number.add(root)
  }
  return { map, size: number.size }
}

function repairConnectivity(edges, nodes) {
  const ids = nodes.map((n) => n.id)
  let guard = 0
  while (guard++ < ids.length + 5) {
    const c = components(ids, edges)
    if (c.size <= 1) break
    const cross = edges.filter((e) => !e.active && c.map[e.a] !== c.map[e.b])
    if (cross.length === 0) break
    cross[randInt(0, cross.length - 1)].active = true
  }
}

/* -------------------- 3. Эвристика и A* -------------------- */
// Масштаб эвристики: средний вес одного ребра на пиксель длины.
// Так h (евклидово расстояние на SVG-плоскости) сопоставим с g (сумма весов).
function heuristicScale(nodes, edges) {
  const pos = new Map(nodes.map((n) => [n.id, n]))
  const active = edges.filter((e) => e.active)
  if (active.length === 0) return 0
  const avgW =
    active.reduce((s, e) => s + (e.weight ?? 1), 0) / active.length
  const avgLen =
    active.reduce((s, e) => s + dist(pos.get(e.a), pos.get(e.b)), 0) /
    active.length
  return avgW / Math.max(avgLen, 1e-6)
}

export function aStar(nodes, edges, startId, endId) {
  if (!startId || !endId) return null

  const active = edges.filter((e) => e.active)
  const adj = buildAdjacency(nodes, edges)
  const pos = new Map(nodes.map((n) => [n.id, n]))
  const hScale = heuristicScale(nodes, edges)
  const h = (id) => dist(pos.get(id), pos.get(endId)) * hScale

  const open = new Set([startId])
  const closed = new Set()
  const came = new Map() // id -> { from, edgeId }
  const g = new Map([[startId, 0]])
  const f = new Map([[startId, h(startId)]])
  const visitedOrder = []

  let found = false
  while (open.size > 0) {
    // берём узел с минимальным f
    let current = null
    let best = Infinity
    for (const id of open) {
      const value = f.get(id) ?? Infinity
      if (value < best) {
        best = value
        current = id
      }
    }

    if (current === endId) {
      found = true
      break
    }

    open.delete(current)
    closed.add(current)
    visitedOrder.push(current)

    for (const { to, w, edgeId } of adj.get(current)) {
      if (closed.has(to)) continue
      const tentative = (g.get(current) ?? Infinity) + w
      if (tentative < (g.get(to) ?? Infinity)) {
        came.set(to, { from: current, edgeId })
        g.set(to, tentative)
        f.set(to, tentative + h(to))
        open.add(to)
      }
    }
  }

  if (!found) {
    return { found: false, path: [], nodeSet: new Set(), edgeIds: new Set(), cost: null, visitedOrder }
  }

  // восстановление пути
  const path = [endId]
  const nodeSet = new Set([endId])
  const edgeIds = new Set()
  let cur = endId
  while (cur !== startId) {
    const step = came.get(cur)
    if (!step) break
    edgeIds.add(step.edgeId)
    path.unshift(step.from)
    nodeSet.add(step.from)
    cur = step.from
  }

  return {
    found: true,
    path,
    nodeSet,
    edgeIds,
    cost: Math.round(g.get(endId) ?? 0),
    visitedOrder,
  }
}

/* -------------------- 4. BFS-волна от старта -------------------- */
// Уровень узла = число шагов от старта. Нужен для задержки анимации
// "расползания" импульса по всем доступным линиям.
export function bfsLevels(nodes, edges, startId) {
  const adj = buildAdjacency(nodes, edges)
  const level = new Map()
  if (!startId) return level
  level.set(startId, 0)
  const queue = [startId]
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const { to } of adj.get(cur)) {
      if (!level.has(to)) {
        level.set(to, level.get(cur) + 1)
        queue.push(to)
      }
    }
  }

  // уровень ребра — по ближайшему концу
  const edgeLevel = {}
  for (const e of edges) {
    const la = level.has(e.a) ? level.get(e.a) : Infinity
    const lb = level.has(e.b) ? level.get(e.b) : Infinity
    edgeLevel[e.id] = Math.min(la, lb)
  }
  return { nodeLevel: level, edgeLevel }
}
