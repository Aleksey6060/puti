// Сетка из пятиугольников — мозаика Каира (Cairo pentagonal tiling).
//
// Правильные пятиугольники плоскость не замощают (угол 108° не делит 360°),
// но мозаика Каира замощает: это двойственная укладка к «snub square tiling».
// Здесь используется целочисленная (коллинеарная) форма плитки:
// вершины (2,0), (3,3), (0,4), (-3,3), (-2,0) — четыре равные стороны
// длиной sqrt(10) и одна сторона длиной 4, углы 90°, ~143.1°, 90°, ~108.4°.
//
// Соседи берутся через каждую из пяти сторон:
//   • у двух правых углов (v1 и v3) сосед получается поворотом плитки
//     на ±90° вокруг самого угла;
//   • через «свободную» сторону (v4–v0) — поворотом на 180° вокруг её
//     середины.
// Проверено: у внутренних плиток ровно 5 соседей, рёбра делятся между
// двумя плитками, замощение без щелей и нахлёстов, а координационная
// последовательность 1,5,11,16,21,27,... совпадает с настоящей мозаикой Каира.

const SCALE = 100 // масштаб мировых координат
const R_FIELD = 21 // радиус круглого поля в единицах плитки
// плитку сжимаем к центру: между соседями появляется «шов», в котором
// видны линии путей и подписи расстояний. Чем меньше INSET, тем шире швы
// и тем свободнее смотрится сетка (числа расстояний перестают наезжать
// на плитки)
const INSET = 0.56
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// базовый пятиугольник (обход против часовой стрелки), площадь 18
const BASE = [
  [2, 0],
  [3, 3],
  [0, 4],
  [-3, 3],
  [-2, 0],
]

const rotate = ([x, y], [cx, cy], a) => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * c - dy * s, cy + dx * s + dy * c]
}
const rotateTile = (t, c, a) => t.map((p) => rotate(p, c, a))

const centroid = (t) => {
  let x = 0
  let y = 0
  for (const [px, py] of t) {
    x += px
    y += py
  }
  return [x / t.length, y / t.length]
}

const round3 = (v) => {
  const r = Math.round(v * 1000) / 1000
  return r === 0 ? 0 : r
}
const keyOf = (t) => {
  const c = centroid(t)
  return `${round3(c[0])},${round3(c[1])}`
}

// пять соседей плитки — по одной на каждую сторону
function neighborTiles(t) {
  const v0 = t[0]
  const v1 = t[1]
  const v3 = t[3]
  const v4 = t[4]
  const mid = [(v4[0] + v0[0]) / 2, (v4[1] + v0[1]) / 2]
  return [
    rotateTile(t, v1, Math.PI / 2),
    rotateTile(t, v1, -Math.PI / 2),
    rotateTile(t, v3, Math.PI / 2),
    rotateTile(t, v3, -Math.PI / 2),
    rotateTile(t, mid, Math.PI),
  ]
}

export function buildPentGrid() {
  // 1. выращиваем мозаику обходом в ширину (с небольшим запасом за границей)
  const grown = new Map()
  grown.set(keyOf(BASE), BASE)
  const queue = [BASE]
  while (queue.length) {
    const t = queue.pop()
    for (const nb of neighborTiles(t)) {
      const k = keyOf(nb)
      if (grown.has(k)) continue
      const c = centroid(nb)
      if (Math.hypot(c[0], c[1]) > R_FIELD + 4) continue
      grown.set(k, nb)
      queue.push(nb)
    }
  }

  // 2. оставляем плитки внутри круглого поля
  const inside = new Map()
  for (const [k, t] of grown) {
    const c = centroid(t)
    if (Math.hypot(c[0], c[1]) <= R_FIELD) inside.set(k, t)
  }

  // 3. берём только крупнейшую связную компоненту, чтобы не осталось
  //    «оторванных» плиток у края
  const adjKeys = (k) =>
    neighborTiles(inside.get(k))
      .map(keyOf)
      .filter((nk) => inside.has(nk))
  let best = []
  const seenComp = new Set()
  for (const k of inside.keys()) {
    if (seenComp.has(k)) continue
    const comp = []
    const stack = [k]
    seenComp.add(k)
    while (stack.length) {
      const cur = stack.pop()
      comp.push(cur)
      for (const nk of adjKeys(cur)) {
        if (!seenComp.has(nk)) {
          seenComp.add(nk)
          stack.push(nk)
        }
      }
    }
    if (comp.length > best.length) best = comp
  }

  // 4. размечаем точки: буква — ряд по y (сверху вниз), цифра — позиция
  //    в ряду слева направо
  const tiles = best.map((k) => ({ k, t: inside.get(k) }))
  const rows = new Map()
  for (const item of tiles) {
    const y = Math.round(centroid(item.t)[1])
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push(item)
  }
  const rowKeys = [...rows.keys()].sort((a, b) => b - a)

  const nodes = []
  const idByKey = new Map()
  const keyById = new Map()
  let j = 0
  for (const y of rowKeys) {
    const letter = ALPHABET[j] ?? '?'
    const inRow = rows.get(y).sort((a, b) => centroid(a.t)[0] - centroid(b.t)[0])
    let i = 0
    for (const item of inRow) {
      const c = centroid(item.t)
      const node = {
        id: `${letter}${i + 1}`,
        x: c[0] * SCALE,
        y: c[1] * SCALE,
        pts: item.t.map(([px, py]) => [
          (c[0] + (px - c[0]) * INSET) * SCALE,
          (c[1] + (py - c[1]) * INSET) * SCALE,
        ]),
        i,
        j,
      }
      nodes.push(node)
      idByKey.set(item.k, node.id)
      keyById.set(node.id, item.k)
      i++
    }
    j++
  }

  // 5. рёбра — между плитками, имеющими общую сторону
  const edges = []
  const seenEdge = new Set()
  for (const node of nodes) {
    for (const nk of adjKeys(keyById.get(node.id))) {
      const other = idByKey.get(nk)
      if (!other) continue
      const id = [node.id, other].sort().join('-')
      if (seenEdge.has(id)) continue
      seenEdge.add(id)
      edges.push({ id, a: node.id, b: other, weight: null, active: true })
    }
  }

  // 6. габариты поля по вершинам пятиугольников
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    for (const [px, py] of n.pts) {
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  }
  const bounds = { minX, maxX, minY, maxY }

  // 7. характерный размер плитки (радиус описанной вокруг центра окружности,
  //    уже с учётом сжатия) — от него считаются толщины линий и шрифты
  const c0 = centroid(BASE)
  const cellR =
    Math.max(...BASE.map((p) => Math.hypot(p[0] - c0[0], p[1] - c0[1]))) *
    INSET *
    SCALE

  return { nodes, edges, cellR, bounds }
}
