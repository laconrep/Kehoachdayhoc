import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GRADES, STATUSES, TRACK_LABELS, type StatusName, type TrackType } from './constants'
import type { AppState, ClassRow, ImportPreview, ItemRow, LessonRow, PpctItemDraft, SettingsRow, SlotRow, SubjectRow, TeacherRow, TrackRow } from './types'

const FILE = join(process.cwd(), 'storage', 'ppct-data.json')

type Tables = {
  nextId: number
  teachers: Array<{ id: number; userId: string; name: string }>
  subjects: Array<{ id: number; userId: string; name: string; grade: number; weeklyPeriods: number }>
  tracks: Array<{ id: number; userId: string; subjectId: number; type: TrackType; name: string; lessonCount: number; sourceFile: string | null; importedAt: string | null }>
  items: Array<{ id: number; userId: string; trackId: number; period: number; title: string; content: string; requirement: string; warning: string }>
  classes: Array<{ id: number; userId: string; name: string; grade: number; subjectId: number; teacherId: number | null }>
  electives: Array<{ id: number; userId: string; classId: number; trackId: number; weeklyHours: number }>
  slots: Array<{ id: number; userId: string; classId: number; day: number; session: string; period: number; type: TrackType }>
  lessons: Array<{ id: number; userId: string; slotId: number; classId: number; week: number; date: string; itemId: number | null; status: string; note: string }>
  settings: Array<{ userId: string; schoolYear: string; startDate: string; totalWeeks: number; teacherName: string }>
}

function empty(): Tables {
  return { nextId: 1, teachers: [], subjects: [], tracks: [], items: [], classes: [], electives: [], slots: [], lessons: [], settings: [] }
}

let cache: Tables | null = null

function load(): Tables {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8')) as Tables
  } catch {
    cache = empty()
  }
  return cache
}

function save(data: Tables) {
  cache = data
  mkdirSync(join(process.cwd(), 'storage'), { recursive: true })
  writeFileSync(FILE, JSON.stringify(data))
}

function nid(data: Tables) {
  return data.nextId++
}

function mondayThisWeek(): string {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day))
  return monday.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function uniquify(items: PpctItemDraft[]): [PpctItemDraft[], number[]] {
  const unique: PpctItemDraft[] = []
  const seen = new Set<number>()
  const skipped: number[] = []
  for (const item of items) {
    const number = Number(item.tiet_so) || 0
    const lesson = String(item.bai_hoc || '').trim()
    if (number < 1 || !lesson) continue
    if (seen.has(number)) { skipped.push(number); continue }
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

export async function loadState(userId: string, userName = ''): Promise<AppState> {
  const data = load()
  const teacherRows = data.teachers.filter((t) => t.userId === userId).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const subjectRows = data.subjects.filter((s) => s.userId === userId).sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'vi'))
  const trackRows = data.tracks.filter((t) => t.userId === userId)
  const itemRows = data.items.filter((i) => i.userId === userId).sort((a, b) => a.period - b.period || a.id - b.id)
  const classRows = data.classes.filter((c) => c.userId === userId).sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'vi'))
  const electiveRows = data.electives.filter((e) => e.userId === userId)
  const slotRows = data.slots.filter((s) => s.userId === userId)
  const lessonRows = data.lessons.filter((l) => l.userId === userId)
  const setting = data.settings.find((s) => s.userId === userId)
  const teacherMap = new Map(teacherRows.map((t) => [t.id, t.name]))
  const subjectMap = new Map(subjectRows.map((s) => [s.id, s]))
  const mappedTracks: TrackRow[] = trackRows.map((t) => ({ id: t.id, subjectId: t.subjectId, type: t.type, name: t.name, lessonCount: t.lessonCount, sourceFile: t.sourceFile, importedAt: t.importedAt }))
  const mappedSubjects: SubjectRow[] = subjectRows.map((s) => ({ id: s.id, name: s.name, grade: s.grade, weeklyPeriods: s.weeklyPeriods, tracks: mappedTracks.filter((t) => t.subjectId === s.id) }))
  const assignedCore = new Map<number, number>()
  for (const slot of slotRows) if (slot.type === 'chinh_khoa') assignedCore.set(slot.classId, (assignedCore.get(slot.classId) || 0) + 1)
  const electiveByClass = new Map(electiveRows.map((e) => [e.classId, e]))
  const mappedClasses: ClassRow[] = classRows.map((row) => {
    const subject = subjectMap.get(row.subjectId)
    const elective = electiveByClass.get(row.id)
    return {
      id: row.id, name: row.name, grade: row.grade, subjectId: row.subjectId, subjectName: subject?.name || '',
      teacherId: row.teacherId, teacherName: row.teacherId ? teacherMap.get(row.teacherId) || '' : '',
      weeklyCore: subject?.weeklyPeriods || 0, assignedCore: assignedCore.get(row.id) || 0,
      electiveTrackId: elective?.trackId || null, electiveHours: elective?.weeklyHours || 0,
    }
  })
  const classMap = new Map(mappedClasses.map((c) => [c.id, c]))
  const mappedSlots: SlotRow[] = slotRows.map((s) => ({ id: s.id, classId: s.classId, teacherId: classMap.get(s.classId)?.teacherId || null, day: s.day, session: s.session, period: s.period, type: s.type }))
  const itemMap = new Map(itemRows.map((i) => [i.id, i]))
  const slotMap = new Map(mappedSlots.map((s) => [s.id, s]))
  const mappedItems: ItemRow[] = itemRows.map((i) => ({ id: i.id, trackId: i.trackId, period: i.period, title: i.title, content: i.content, requirement: i.requirement, warning: i.warning }))
  const mappedLessons: LessonRow[] = lessonRows.map((lesson) => {
    const slot = slotMap.get(lesson.slotId)
    const cls = classMap.get(lesson.classId)
    const item = lesson.itemId ? itemMap.get(lesson.itemId) : undefined
    return {
      id: lesson.id, slotId: lesson.slotId, classId: lesson.classId, teacherId: cls?.teacherId || null, teacherName: cls?.teacherName || '',
      subjectName: cls?.subjectName || '', className: cls?.name || '', week: lesson.week, date: lesson.date,
      day: slot?.day || 2, session: slot?.session || 'Sáng', period: slot?.period || 1, type: slot?.type || 'chinh_khoa',
      itemId: lesson.itemId, itemPeriod: item?.period ?? null, title: item?.title || '',
      status: (STATUSES.includes(lesson.status as StatusName) ? lesson.status : 'Bình thường') as StatusName,
      note: lesson.note || '',
    }
  }).sort((a, b) => a.week - b.week || a.day - b.day || a.session.localeCompare(b.session, 'vi') || a.period - b.period || a.className.localeCompare(b.className, 'vi'))
  const settingsValue: SettingsRow = {
    schoolYear: setting?.schoolYear || `${new Date().getFullYear()} – ${new Date().getFullYear() + 1}`,
    startDate: setting?.startDate || mondayThisWeek(),
    totalWeeks: setting?.totalWeeks || 35,
    teacherName: setting?.teacherName || '',
  }
  const teachersOut: TeacherRow[] = teacherRows.map((t) => ({ id: t.id, name: t.name }))
  return {
    userName, settings: settingsValue, teachers: teachersOut, subjects: mappedSubjects, items: mappedItems, classes: mappedClasses, slots: mappedSlots, lessons: mappedLessons,
    stats: { tracks: mappedTracks.length, classes: mappedClasses.length, slots: mappedSlots.length, lessons: mappedLessons.length, taught: mappedLessons.filter((l) => l.status !== 'Nghỉ' && l.itemId).length, totalItems: mappedItems.length },
  }
}

export async function findOrCreateTeacher(userId: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Nhập tên giáo viên.')
  const data = load()
  const found = data.teachers.find((t) => t.userId === userId && t.name === trimmed)
  if (found) return found.id
  const id = nid(data)
  data.teachers.push({ id, userId, name: trimmed })
  save(data)
  return id
}

export async function upsertSettings(userId: string, payload: { schoolYear: string; startDate: string; totalWeeks: number; teacherName: string }) {
  const data = load()
  const idx = data.settings.findIndex((s) => s.userId === userId)
  if (idx >= 0) data.settings[idx] = { userId, ...payload }
  else data.settings.push({ userId, ...payload })
  save(data)
}

async function writeTrack(data: Tables, userId: string, subjectId: number, type: TrackType, name: string, items: PpctItemDraft[], filename: string) {
  const existing = data.tracks.find((t) => t.subjectId === subjectId && t.type === type)
  const track = existing || { id: nid(data), userId, subjectId, type, name, lessonCount: items.length, sourceFile: filename, importedAt: new Date().toISOString() }
  if (existing) {
    for (const lesson of data.lessons) {
      if (lesson.itemId && data.items.some((i) => i.id === lesson.itemId && i.trackId === existing.id)) lesson.itemId = null
    }
    data.items = data.items.filter((i) => i.trackId !== existing.id)
    existing.name = name
    existing.lessonCount = items.length
    existing.sourceFile = filename
    existing.importedAt = new Date().toISOString()
  } else {
    data.tracks.push(track)
  }
  for (const item of items) {
    data.items.push({ id: nid(data), userId, trackId: track.id, period: item.tiet_so, title: item.bai_hoc, content: item.noi_dung_chi_tiet, requirement: item.yeu_cau_can_dat, warning: item.canh_bao })
  }
}

export async function saveImport(userId: string, preview: ImportPreview, subjectName: string, weekly: number, posted: Record<TrackType, PpctItemDraft[]>) {
  const name = subjectName.trim()
  if (!name) throw new Error('Nhập tên môn học.')
  if (!GRADES.includes(preview.grade as 10 | 11 | 12)) throw new Error('Khối không hợp lệ.')
  const hours = Math.max(1, weekly)
  const data = load()
  let subject = data.subjects.find((s) => s.userId === userId && s.name === name && s.grade === preview.grade)
  if (subject) subject.weeklyPeriods = hours
  else {
    subject = { id: nid(data), userId, name, grade: preview.grade, weeklyPeriods: hours }
    data.subjects.push(subject)
  }
  const savedTypes: string[] = []
  const skippedAll: number[] = []
  for (const type of ['chinh_khoa', 'chuyen_de'] as TrackType[]) {
    const [items, skipped] = uniquify(posted[type] || [])
    if (!items.length) continue
    await writeTrack(data, userId, subject.id, type, TRACK_LABELS[type], items, preview.filename)
    savedTypes.push(`${TRACK_LABELS[type]} ${items.length} tiết`)
    skippedAll.push(...skipped)
  }
  if (!savedTypes.length) throw new Error('Không có dòng PPCT hợp lệ để lưu.')
  const cd = data.tracks.find((t) => t.subjectId === subject.id && t.type === 'chuyen_de')
  if (cd) {
    for (const cls of data.classes.filter((c) => c.userId === userId && c.subjectId === subject.id)) {
      if (!data.electives.some((e) => e.classId === cls.id && e.trackId === cd.id)) {
        data.electives.push({ id: nid(data), userId, classId: cls.id, trackId: cd.id, weeklyHours: 1 })
      }
    }
  }
  save(data)
  return { savedTypes, skippedAll }
}

export async function updateSavedPpct(userId: string, subjectId: number, posted: Record<TrackType, PpctItemDraft[]>) {
  const data = load()
  const subject = data.subjects.find((s) => s.id === subjectId && s.userId === userId)
  if (!subject) throw new Error('Không tìm thấy môn học.')
  const tracks = data.tracks.filter((t) => t.subjectId === subjectId && t.userId === userId)
  if (!tracks.length) throw new Error('Môn này chưa có PPCT để sửa.')
  const updated: string[] = []
  for (const track of tracks) {
    const [items] = uniquify(posted[track.type] || [])
    if (!items.length) continue
    for (const lesson of data.lessons) {
      if (lesson.itemId && data.items.some((i) => i.id === lesson.itemId && i.trackId === track.id)) lesson.itemId = null
    }
    data.items = data.items.filter((i) => i.trackId !== track.id)
    track.lessonCount = items.length
    track.importedAt = new Date().toISOString()
    for (const item of items) data.items.push({ id: nid(data), userId, trackId: track.id, period: item.tiet_so, title: item.bai_hoc, content: item.noi_dung_chi_tiet, requirement: item.yeu_cau_can_dat, warning: item.canh_bao })
    updated.push(`${track.type === 'chinh_khoa' ? 'Chính khóa' : 'Chuyên đề'} ${items.length} tiết`)
  }
  save(data)
  return updated
}

export async function addClass(userId: string, name: string, subjectId: number, teacherName: string) {
  const data = load()
  const subject = data.subjects.find((s) => s.id === subjectId && s.userId === userId)
  if (!subject) throw new Error('Chọn môn–khối và nhập tên lớp.')
  const teacherId = await findOrCreateTeacher(userId, teacherName)
  const tables = load()
  const id = nid(tables)
  tables.classes.push({ id, userId, name: name.trim(), grade: subject.grade, subjectId, teacherId })
  const cd = tables.tracks.find((t) => t.subjectId === subjectId && t.type === 'chuyen_de')
  if (cd) tables.electives.push({ id: nid(tables), userId, classId: id, trackId: cd.id, weeklyHours: 1 })
  const setting = tables.settings.find((s) => s.userId === userId)
  if (!setting?.teacherName) {
    const next = { schoolYear: setting?.schoolYear || `${new Date().getFullYear()} – ${new Date().getFullYear() + 1}`, startDate: setting?.startDate || mondayThisWeek(), totalWeeks: setting?.totalWeeks || 35, teacherName }
    if (setting) Object.assign(setting, next)
    else tables.settings.push({ userId, ...next })
  }
  save(tables)
  return { id, name: name.trim() }
}

export async function assignTeacher(userId: string, classId: number, teacherName: string) {
  const teacherId = await findOrCreateTeacher(userId, teacherName)
  const data = load()
  const cls = data.classes.find((c) => c.id === classId && c.userId === userId)
  if (!cls) throw new Error('Không tìm thấy lớp.')
  cls.teacherId = teacherId
  save(data)
}

export async function assignElective(userId: string, classId: number, trackId: number, hours: number) {
  const data = load()
  const cls = data.classes.find((c) => c.id === classId && c.userId === userId)
  const track = data.tracks.find((t) => t.id === trackId && t.userId === userId)
  if (!cls || !track) throw new Error('Lớp hoặc chuyên đề không hợp lệ.')
  const existing = data.electives.find((e) => e.classId === classId && e.trackId === trackId)
  if (existing) existing.weeklyHours = Math.max(1, hours)
  else data.electives.push({ id: nid(data), userId, classId, trackId, weeklyHours: Math.max(1, hours) })
  save(data)
}

export async function saveTimetable(userId: string, slots: Array<{ classId: number; day: number; session: string; period: number; type: TrackType }>, teacherId?: number) {
  const data = load()
  const classList = data.classes.filter((c) => c.userId === userId)
  const classMap = new Map(classList.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const incoming: Array<{ classId: number; day: number; session: string; period: number; type: TrackType }> = []
  for (const slot of slots) {
    const cls = classMap.get(slot.classId)
    if (!cls) throw new Error('Lớp không tồn tại.')
    if (teacherId && cls.teacherId !== teacherId) throw new Error('Lớp không thuộc giáo viên đang xếp TKB.')
    const key = `${cls.teacherId || 0}|${slot.day}|${slot.session}|${slot.period}`
    if (seen.has(key)) throw new Error('Một giáo viên không thể gán hai lớp cùng một ô TKB.')
    seen.add(key)
    incoming.push({ classId: slot.classId, day: slot.day, session: slot.session, period: slot.period, type: slot.type === 'chuyen_de' ? 'chuyen_de' : 'chinh_khoa' })
  }
  const ownedIds = new Set(teacherId ? classList.filter((c) => c.teacherId === teacherId).map((c) => c.id) : classList.map((c) => c.id))
  const keep: Tables['slots'] = []
  const removedIds = new Set<number>()
  for (const slot of data.slots) {
    if (slot.userId !== userId) { keep.push(slot); continue }
    if (!ownedIds.has(slot.classId)) { keep.push(slot); continue }
    const match = incoming.find((s) => s.classId === slot.classId && s.day === slot.day && s.session === slot.session && s.period === slot.period)
    if (match) {
      slot.type = match.type
      keep.push(slot)
      incoming.splice(incoming.indexOf(match), 1)
    } else removedIds.add(slot.id)
  }
  for (const slot of incoming) keep.push({ id: nid(data), userId, ...slot })
  data.slots = keep
  if (removedIds.size) data.lessons = data.lessons.filter((l) => !removedIds.has(l.slotId))
  save(data)
}

export async function generateYearSchedule(userId: string) {
  const data = load()
  const setting = data.settings.find((s) => s.userId === userId)
  const weeks = Math.max(1, setting?.totalWeeks || 35)
  const start = setting?.startDate || mondayThisWeek()
  const subjectRows = data.subjects.filter((s) => s.userId === userId)
  const trackRows = data.tracks.filter((t) => t.userId === userId)
  const itemRows = data.items.filter((i) => i.userId === userId).sort((a, b) => a.period - b.period || a.id - b.id)
  const classRows = data.classes.filter((c) => c.userId === userId)
  const electiveRows = data.electives.filter((e) => e.userId === userId)
  const slotRows = data.slots.filter((s) => s.userId === userId)
  const subjectMap = new Map(subjectRows.map((s) => [s.id, s]))
  const itemsByTrack = new Map<number, typeof itemRows>()
  for (const item of itemRows) {
    const list = itemsByTrack.get(item.trackId) || []
    list.push(item)
    itemsByTrack.set(item.trackId, list)
  }
  const coreBySubject = new Map<number, number>()
  for (const track of trackRows) if (track.type === 'chinh_khoa') coreBySubject.set(track.subjectId, track.id)
  const electiveByClass = new Map(electiveRows.map((e) => [e.classId, e]))
  const khoiProgress = new Map<string, number>()
  for (const track of trackRows) {
    const subject = subjectMap.get(track.subjectId)
    const items = itemsByTrack.get(track.id) || []
    if (!subject || !items.length || track.type !== 'chinh_khoa') continue
    let pointer = 0
    for (let w = 1; w <= weeks && pointer < items.length; w++) {
      for (let order = 1; order <= subject.weeklyPeriods && pointer < items.length; order++) {
        khoiProgress.set(`${subject.grade}|${track.id}|${w}|${order}`, items[pointer++].id)
      }
    }
  }
  const classProgress = new Map<string, number>()
  for (const assignment of electiveRows) {
    const items = itemsByTrack.get(assignment.trackId) || []
    let pointer = 0
    for (let w = 1; w <= weeks && pointer < items.length; w++) {
      for (let order = 1; order <= assignment.weeklyHours && pointer < items.length; order++) {
        classProgress.set(`${assignment.classId}|${assignment.trackId}|${w}|${order}`, items[pointer++].id)
      }
    }
  }
  const orderedSlots = [...slotRows].sort((a, b) => a.classId - b.classId || a.day - b.day || (a.session === 'Sáng' ? 0 : 1) - (b.session === 'Sáng' ? 0 : 1) || a.period - b.period)
  const classMap = new Map(classRows.map((c) => [c.id, c]))
  const rows: Tables['lessons'] = []
  for (let week = 1; week <= weeks; week++) {
    const slotOrders = new Map<string, number>()
    for (const slot of orderedSlots) {
      const cls = classMap.get(slot.classId)
      if (!cls) continue
      const key = `${slot.classId}:${slot.type}`
      const order = (slotOrders.get(key) || 0) + 1
      slotOrders.set(key, order)
      let itemId: number | null = null
      if (slot.type === 'chinh_khoa') {
        const trackId = coreBySubject.get(cls.subjectId)
        if (trackId) itemId = khoiProgress.get(`${cls.grade}|${trackId}|${week}|${order}`) || null
      } else {
        const elective = electiveByClass.get(slot.classId)
        if (elective) itemId = classProgress.get(`${slot.classId}|${elective.trackId}|${week}|${order}`) || null
      }
      rows.push({ id: 0, userId, slotId: slot.id, classId: slot.classId, week, date: addDays(start, (week - 1) * 7 + (slot.day - 2)), itemId, status: 'Bình thường', note: '' })
    }
  }
  data.lessons = [...data.lessons.filter((l) => l.userId !== userId), ...rows.map((r) => ({ ...r, id: nid(data) }))]
  save(data)
  return rows.length
}

export async function updateLesson(userId: string, lessonId: number, status: string, note: string, itemId: number | null) {
  if (!STATUSES.includes(status as StatusName)) throw new Error('Trạng thái giảng dạy không hợp lệ.')
  const data = load()
  const lesson = data.lessons.find((l) => l.id === lessonId && l.userId === userId)
  if (!lesson) throw new Error('Không tìm thấy buổi dạy cần cập nhật.')
  lesson.status = status
  lesson.note = note.trim()
  lesson.itemId = status === 'Nghỉ' ? null : itemId
  save(data)
}
