import { inflateRawSync } from 'node:zlib'
import type { TrackType } from './constants'
import type { PpctItemDraft } from './types'

export type ColumnMap = {
  tiet_thu: number | null
  so_tiet_khai_bao: number | null
  ten_bai: number | null
  noi_dung: number | null
  yeu_cau: number | null
}

type TableCandidate = {
  table: number
  headerRow: number
  mapping: ColumnMap
  score: number
  columns: string[]
  gradeHint: number | null
  typeHint: TrackType | null
}

function cellText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

function normalize(text: string): string {
  const ascii = text
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, (ch) => (ch === 'Đ' ? 'D' : 'd'))
  return ascii.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function unzipEntry(buffer: Buffer, name: string): string {
  let offset = 0
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break
    const flags = buffer.readUInt16LE(offset + 6)
    const method = buffer.readUInt16LE(offset + 8)
    let compSize = buffer.readUInt32LE(offset + 18)
    const nameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)
    const fileName = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    let dataStart = offset + 30 + nameLen + extraLen
    if (flags & 0x8) {
      const desc = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), dataStart)
      if (desc < 0) throw new Error('Không thể đọc tệp .docx.')
      compSize = buffer.readUInt32LE(desc + 8)
      const data = buffer.subarray(dataStart, dataStart + compSize)
      if (fileName === name) return inflateEntry(method, data)
      offset = desc + 16
      continue
    }
    const data = buffer.subarray(dataStart, dataStart + compSize)
    if (fileName === name) return inflateEntry(method, data)
    offset = dataStart + compSize
  }
  throw new Error('Không tìm thấy nội dung tài liệu Word.')
}

function inflateEntry(method: number, data: Buffer): string {
  if (method === 0) return data.toString('utf8')
  if (method === 8) return inflateRawSync(data).toString('utf8')
  throw new Error('Không thể giải nén tệp Word.')
}

function extractBlocks(xml: string, tag: string): string[] {
  const out: string[] = []
  const open = `<w:${tag}`
  const close = `</w:${tag}>`
  let i = 0
  while (i < xml.length) {
    const start = xml.indexOf(open, i)
    if (start < 0) break
    const afterTag = xml.indexOf('>', start)
    if (afterTag < 0) break
    if (xml[afterTag - 1] === '/') {
      i = afterTag + 1
      continue
    }
    const end = xml.indexOf(close, afterTag + 1)
    if (end < 0) break
    out.push(xml.slice(afterTag + 1, end))
    i = end + close.length
  }
  return out
}

function paragraphText(pXml: string): string {
  const parts: string[] = []
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(pXml))) {
    parts.push(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
  }
  return parts.join('').replace(/[\t ]+/gu, ' ').trim()
}

function wordCellText(tcXml: string): string {
  return extractBlocks(tcXml, 'p').map(paragraphText).filter(Boolean).join('\n')
}

function gridSpan(tcXml: string): number {
  const match = tcXml.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/) || tcXml.match(/<w:gridSpan\b[^>]*val="(\d+)"/)
  return Math.max(1, match ? Number(match[1]) : 1)
}

function trackTypeFromText(text: string): TrackType | null {
  const n = normalize(text)
  if (n.includes('CHUYEN DE')) return 'chuyen_de'
  if (n.includes('CHINH KHOA') || n.includes('BAT BUOC')) return 'chinh_khoa'
  return null
}

function mapColumns(headers: string[]): ColumnMap {
  const mapping: ColumnMap = { tiet_thu: null, so_tiet_khai_bao: null, ten_bai: null, noi_dung: null, yeu_cau: null }
  headers.forEach((header, i) => {
    const n = normalize(header)
    if (n.includes('BAI HOC') || n.includes('CHU DE') || n.includes('CHUYEN DE')) {
      if (mapping.ten_bai === null) mapping.ten_bai = i
      else if (mapping.noi_dung === null) mapping.noi_dung = i
    }
    if ((n === 'SO TIET' || (n.startsWith('SO') && n.includes('TIET') && !n.includes('THU'))) && mapping.so_tiet_khai_bao === null) mapping.so_tiet_khai_bao = i
    if (n.includes('TIET') && n.includes('THU') && mapping.tiet_thu === null) mapping.tiet_thu = i
    if (n.includes('TIET') && n.includes('TUAN') && mapping.tiet_thu === null) mapping.tiet_thu = i
    if ((n.includes('NOI DUNG') || n.includes('HOAT DONG')) && mapping.noi_dung === null) mapping.noi_dung = i
    if (n.includes('YEU CAU CAN DAT') && mapping.yeu_cau === null) mapping.yeu_cau = i
  })
  if (mapping.tiet_thu === null && mapping.so_tiet_khai_bao !== null) {
    mapping.tiet_thu = mapping.so_tiet_khai_bao
    mapping.so_tiet_khai_bao = null
  }
  if (mapping.noi_dung === null && mapping.ten_bai !== null && mapping.tiet_thu !== null && mapping.tiet_thu > mapping.ten_bai + 1) {
    mapping.noi_dung = mapping.tiet_thu - 1
  }
  return mapping
}

export function parseTietField(raw: string, declared: number | null): [number[], 'literal' | 'range' | 'mismatch'] {
  const cleaned = raw.replace(/-\s*\r?\n\s*/gu, '-')
  const groups = cleaned.split(/(?:[;,]|\r?\n)+/u).map((s) => s.trim()).filter(Boolean)
  const build = (mode: 'literal' | 'range') => {
    const result: number[] = []
    for (const group of groups) {
      const nums = Array.from(group.matchAll(/\d+/g)).map((m) => Number(m[0]))
      if (mode === 'range' && nums.length === 2 && (group.match(/-/g) || []).length === 1) {
        const start = Math.min(nums[0], nums[1])
        const end = Math.max(nums[0], nums[1])
        for (let n = start; n <= end; n++) result.push(n)
      } else result.push(...nums)
    }
    return result
  }
  const literal = build('literal')
  if (declared === null || literal.length === declared) return [literal, 'literal']
  const ranged = build('range')
  if (ranged.length === declared) return [ranged, 'range']
  return [literal, 'mismatch']
}

function parseTable(table: string[][], headerRow: number, map: ColumnMap): PpctItemDraft[] {
  if (map.tiet_thu === null || map.ten_bai === null) return []
  const items: PpctItemDraft[] = []
  let lastLesson = ''
  for (const raw of table.slice(headerRow + 1)) {
    const cells = raw.map((text) => String(text).trim())
    if (!cells.length || !cells.some(Boolean)) continue
    if ((cells[0] || '').toLowerCase().startsWith('tổng')) continue
    if (new Set(cells).size === 1) continue
    const tietRaw = cells[map.tiet_thu] || ''
    let lesson = cells[map.ten_bai] || ''
    if (lesson) lastLesson = cellText(lesson)
    else lesson = lastLesson
    if (!tietRaw || !lesson) continue
    const declaredRaw = map.so_tiet_khai_bao !== null ? cells[map.so_tiet_khai_bao] || '' : ''
    const declaredMatch = declaredRaw.match(/\d+/)
    const declared = declaredMatch ? Number(declaredMatch[0]) : null
    const [numbers, meaning] = parseTietField(tietRaw, declared)
    for (const number of numbers) {
      if (number < 1) continue
      items.push({
        tiet_so: number,
        bai_hoc: lesson,
        noi_dung_chi_tiet: map.noi_dung !== null ? cellText(cells[map.noi_dung] || '') : '',
        yeu_cau_can_dat: map.yeu_cau !== null ? cellText(cells[map.yeu_cau] || '') : '',
        canh_bao: meaning === 'mismatch' ? `Cột số tiết không khớp: “${tietRaw}”` : '',
      })
    }
  }
  items.sort((a, b) => a.tiet_so - b.tiet_so)
  return items
}

function classifyCandidate(candidate: TableCandidate): TrackType {
  return candidate.typeHint || trackTypeFromText(candidate.columns.join(' ')) || 'chinh_khoa'
}

export function guessSubjectName(filename: string, docText = ''): string {
  const fromDoc = docText.match(/Môn\s*(?:học)?\s*[:\-–]?\s*([^\r\n,;]+)/iu)
  if (fromDoc?.[1]) {
    const name = fromDoc[1].replace(/\s+/gu, ' ').trim()
    if (name) return name
  }
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/gu, ' ')
  return base.replace(/\b(ppct|phan phoi chuong trinh|khoi|lop|10|11|12|chinh khoa|chuyen de)\b/giu, '').replace(/\s+/gu, ' ').trim()
}

export function uniquifyItems(items: PpctItemDraft[]): [PpctItemDraft[], number[]] {
  const unique: PpctItemDraft[] = []
  const seen = new Set<number>()
  const skipped: number[] = []
  for (const item of items) {
    const number = Number(item.tiet_so) || 0
    const lesson = String(item.bai_hoc || '').trim()
    if (number < 1 || !lesson) continue
    if (seen.has(number)) {
      skipped.push(number)
      continue
    }
    seen.add(number)
    unique.push({
      tiet_so: number,
      bai_hoc: lesson,
      noi_dung_chi_tiet: String(item.noi_dung_chi_tiet || '').trim(),
      yeu_cau_can_dat: String(item.yeu_cau_can_dat || '').trim(),
      canh_bao: String(item.canh_bao || '').trim(),
    })
  }
  return [unique, skipped]
}

function findCandidates(tables: string[][][], tableGrades: Array<number | null>, tableTypes: Array<TrackType | null>): TableCandidate[] {
  const found: TableCandidate[] = []
  tables.forEach((table, tableIndex) => {
    let best = { score: -1, row: 0, mapping: mapColumns([]) }
    table.slice(0, Math.min(5, table.length)).forEach((header, rowIndex) => {
      const map = mapColumns(header)
      const score = (map.tiet_thu !== null ? 3 : 0) + (map.ten_bai !== null ? 3 : 0) + (map.so_tiet_khai_bao !== null ? 1 : 0) + (map.noi_dung !== null ? 1 : 0)
      if (score > best.score) best = { score, row: rowIndex, mapping: map }
    })
    const flatHeader = normalize((table[best.row] || []).join(' '))
    if (best.score >= 3 || (flatHeader.includes('TIET') && flatHeader.includes('TUAN'))) {
      found.push({
        table: tableIndex,
        headerRow: best.row,
        mapping: best.mapping,
        score: best.score,
        columns: table[best.row] || [],
        gradeHint: tableGrades[tableIndex] ?? null,
        typeHint: trackTypeFromText(flatHeader) || tableTypes[tableIndex] || null,
      })
    }
  })
  return found
}

function parseImportGroups(tables: string[][][], candidates: TableCandidate[]): Record<TrackType, PpctItemDraft[]> {
  const groups: Record<TrackType, PpctItemDraft[]> = { chinh_khoa: [], chuyen_de: [] }
  const unhinted = candidates.every((c) => !c.typeHint) && candidates.length >= 2
  candidates.forEach((candidate, index) => {
    const items = parseTable(tables[candidate.table], candidate.headerRow, candidate.mapping)
    if (!items.length) return
    const type = unhinted ? (index === 0 ? 'chinh_khoa' : 'chuyen_de') : classifyCandidate(candidate)
    groups[type] = [...groups[type], ...items]
  })
  ;(Object.keys(groups) as TrackType[]).forEach((type) => {
    const counts = new Map<number, number>()
    for (const item of groups[type]) counts.set(item.tiet_so, (counts.get(item.tiet_so) || 0) + 1)
    groups[type] = groups[type].map((item) => (
      (counts.get(item.tiet_so) || 0) > 1
        ? { ...item, canh_bao: [item.canh_bao, `Trùng số tiết PPCT ${item.tiet_so}`].filter(Boolean).join(' · ') }
        : item
    ))
  })
  return groups
}

function parseDocumentXml(xml: string): { tables: string[][][]; tableGrades: Array<number | null>; tableTypes: Array<TrackType | null>; text: string } {
  const tables = extractBlocks(xml, 'tbl').map((tbl) =>
    extractBlocks(tbl, 'tr').map((tr) => {
      const cells: string[] = []
      for (const tc of extractBlocks(tr, 'tc')) {
        cells.push(wordCellText(tc))
        const span = gridSpan(tc)
        for (let i = 1; i < span; i++) cells.push('')
      }
      return cells
    }).filter((row) => row.length),
  )
  const tableGrades: Array<number | null> = []
  const tableTypes: Array<TrackType | null> = []
  let nearby: string[] = []
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)
  const body = bodyMatch?.[1] || xml
  const tokenRe = /<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g
  let token: RegExpExecArray | null
  while ((token = tokenRe.exec(body))) {
    if (token[1] === 'p') {
      const paragraph = cellText(paragraphText(token[0]))
      if (paragraph) {
        nearby.push(paragraph)
        nearby = nearby.slice(-8)
      }
    } else {
      const context = nearby.join(' ')
      const matches = Array.from(context.matchAll(/(?:khối|lớp)\s*(10|11|12)\b/giu))
      tableGrades.push(matches.length ? Number(matches[matches.length - 1][1]) : null)
      tableTypes.push(trackTypeFromText(context))
    }
  }
  const text = cellText(extractBlocks(xml, 'p').map(paragraphText).join(' '))
  return { tables, tableGrades, tableTypes, text }
}

export async function parseDocx(buffer: Buffer, filename: string): Promise<{
  expected: number | null
  subjectGuess: string
  groups: Record<TrackType, PpctItemDraft[]>
}> {
  const xml = unzipEntry(buffer, 'word/document.xml')
  const { tables, tableGrades, tableTypes, text } = parseDocumentXml(xml)
  const candidates = findCandidates(tables, tableGrades, tableTypes)
  if (!candidates.length) throw new Error('Không tìm thấy bảng PPCT. Hãy dùng tệp Word có hàng tiêu đề chứa “Tiết” và “Bài học”.')
  const groups = parseImportGroups(tables, candidates)
  if (!groups.chinh_khoa.length && !groups.chuyen_de.length) throw new Error('Không thể tách tiết chính khóa / chuyên đề từ tệp này.')
  const expectedMatch = text.match(/Tổng\s*số\s*tiết\s*[:\s]+(\d+)/iu)
  return { expected: expectedMatch ? Number(expectedMatch[1]) : null, subjectGuess: guessSubjectName(filename, text), groups }
}
