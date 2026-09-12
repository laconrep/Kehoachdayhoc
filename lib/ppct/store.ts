import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { classElectives, classes, lessons, ppctItems, ppctTracks, settings, subjects, teachers, timetableSlots } from '@/lib/db/schema'
import { ensureSchema } from '@/lib/db/ensure'
import { GRADES, STATUSES, TRACK_LABELS, type StatusName, type TrackType } from './constants'
import type { AppState, ClassRow, ImportPreview, ItemRow, LessonRow, PpctItemDraft, SettingsRow, SlotRow, SubjectRow, TeacherRow, TrackRow } from './types'

function mondayThisWeek(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return monday.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function loadState(userId: string, userName = ''): Promise<AppState> {
  await ensureSchema()
  const [teacherRows, subjectRows, trackRows, itemRows, classRows, electiveRows, slotRows, lessonRows, settingRows] = await Promise.all([
    db.select().from(teachers).where(eq(teachers.userId, userId)).orderBy(asc(teachers.name)),
    db.select().from(subjects).where(eq(subjects.userId, userId)).orderBy(asc(subjects.grade), asc(subjects.name)),
    db.select().from(ppctTracks).where(eq(ppctTracks.userId, userId)).orderBy(asc(ppctTracks.id)),
    db.select().from(ppctItems).where(eq(ppctItems.userId, userId)).orderBy(asc(ppctItems.period), asc(ppctItems.id)),
    db.select().from(classes).where(eq(classes.userId, userId)).orderBy(asc(classes.grade), asc(classes.name)),
    db.select().from(classElectives).where(eq(classElectives.userId, userId)),
    db.select().from(timetableSlots).where(eq(timetableSlots.userId, userId)),
    db.select().from(lessons).where(eq(lessons.userId, userId)),
    db.select().from(settings).where(eq(settings.userId, userId)).limit(1),
  ])

  const teacherMap = new Map(teacherRows.map((t) => [t.id, t.name]))
  const subjectMap = new Map(subjectRows.map((s) => [s.id, s]))
  const itemsByTrack = new Map<number, ItemRow[]>()
  const mappedItems: ItemRow[] = itemRows.map((item) => ({
    id: item.id,
    trackId: item.trackId,
    period: item.period,
    title: item.title,
    content: item.content,
    requirement: item.requirement,
    warning: item.warning,
  }))
  for (const item of mappedItems) {
    const list = itemsByTrack.get(item.trackId) || []
    list.push(item)
    itemsByTrack.set(item.trackId, list)
  }
  const mappedTracks: TrackRow[] = trackRows.map((track) => ({
    id: track.id,
    subjectId: track.subjectId,
    type: track.type as TrackType,
    name: track.name,
    lessonCount: track.lessonCount,
    sourceFile: track.sourceFile,
    importedAt: track.importedAt ? track.importedAt.toISOString() : null,
  }))
  const mappedSubjects: SubjectRow[] = subjectRows.map((subject) => ({
    id: subject.id,
    name: subject.name,
    grade: subject.grade,
    weeklyPeriods: subject.weeklyPeriods,
    tracks: mappedTracks.filter((t) => t.subjectId === subject.id),
  }))
  const assignedCore = new Map<number, number>()
  for (const slot of slotRows) {
    if (slot.type === 'chinh_khoa') assignedCore.set(slot.classId, (assignedCore.get(slot.classId) || 0) + 1)
  }
  const electiveByClass = new Map<number, { trackId: number; hours: number }>()
  for (const row of electiveRows) electiveByClass.set(row.classId, { trackId: row.trackId, hours: row.weeklyHours })
  const mappedClasses: ClassRow[] = classRows.map((row) => {
    const subject = subjectMap.get(row.subjectId)
    const elective = electiveByClass.get(row.id)
    return {
      id: row.id,
      name: row.name,
      grade: row.grade,
      subjectId: row.subjectId,
      subjectName: subject?.name || '',
      teacherId: row.teacherId,
      teacherName: row.teacherId ? teacherMap.get(row.teacherId) || '' : '',
      weeklyCore: subject?.weeklyPeriods || 0,
      assignedCore: assignedCore.get(row.id) || 0,
      electiveTrackId: elective?.trackId || null,
      electiveHours: elective?.hours || 0,
    }
  })
  const classMap = new Map(mappedClasses.map((c) => [c.id, c]))
  const mappedSlots: SlotRow[] = slotRows.map((slot) => ({
    id: slot.id,
    classId: slot.classId,
    teacherId: classMap.get(slot.classId)?.teacherId || null,
    day: slot.day,
    session: slot.session,
    period: slot.period,
    type: slot.type as TrackType,
  }))
  const itemMap = new Map(mappedItems.map((i) => [i.id, i]))
  const slotMap = new Map(mappedSlots.map((s) => [s.id, s]))
  const mappedLessons: LessonRow[] = lessonRows.map((lesson) => {
    const slot = slotMap.get(lesson.slotId)
    const cls = classMap.get(lesson.classId)
    const item = lesson.itemId ? itemMap.get(lesson.itemId) : undefined
    return {
      id: lesson.id,
      slotId: lesson.slotId,
      classId: lesson.classId,
      teacherId: cls?.teacherId || null,
      teacherName: cls?.teacherName || '',
      subjectName: cls?.subjectName || '',
      className: cls?.name || '',
      week: lesson.week,
      date: lesson.date,
      day: slot?.day || 2,
      session: slot?.session || 'Sáng',
      period: slot?.period || 1,
      type: slot?.type || 'chinh_khoa',
      itemId: lesson.itemId,
      itemPeriod: item?.period ?? null,
      title: item?.title || '',
      status: (STATUSES.includes(lesson.status as StatusName) ? lesson.status : 'Bình thường') as StatusName,
      note: lesson.note || '',
    }
  })
  mappedLessons.sort((a, b) => a.week - b.week || a.day - b.day || a.session.localeCompare(b.session, 'vi') || a.period - b.period || a.className.localeCompare(b.className, 'vi'))
  const setting = settingRows[0]
  const settingsValue: SettingsRow = {
    schoolYear: setting?.schoolYear || `${new Date().getFullYear()} – ${new Date().getFullYear() + 1}`,
    startDate: setting?.startDate || mondayThisWeek(),
    totalWeeks: setting?.totalWeeks || 35,
    teacherName: setting?.teacherName || '',
  }
  const taught = mappedLessons.filter((l) => l.status !== 'Nghỉ' && l.itemId).length
  return {
    userName,
    settings: settingsValue,
    teachers: teacherRows.map((t) => ({ id: t.id, name: t.name })),
    subjects: mappedSubjects,
    items: mappedItems,
    classes: mappedClasses,
    slots: mappedSlots,
    lessons: mappedLessons,
    stats: {
      tracks: mappedTracks.length,
      classes: mappedClasses.length,
      slots: mappedSlots.length,
      lessons: mappedLessons.length,
      taught,
      totalItems: mappedItems.length,
    },
  }
}

export async function findOrCreateTeacher(userId: string, name: string): Promise<number> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Nhập tên giáo viên.')
  const existing = await db.select().from(teachers).where(and(eq(teachers.userId, userId), eq(teachers.name, trimmed))).limit(1)
  if (existing[0]) return existing[0].id
  const [row] = await db.insert(teachers).values({ userId, name: trimmed }).returning()
  return row.id
}

export async function upsertSettings(userId: string, data: { schoolYear: string; startDate: string; totalWeeks: number; teacherName: string }) {
  await ensureSchema()
  const existing = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)
  if (existing[0]) {
    await db.update(settings).set(data).where(eq(settings.userId, userId))
  } else {
    await db.insert(settings).values({ userId, ...data })
  }
}

export async function saveImport(userId: string, preview: ImportPreview, subjectName: string, weekly: number, posted: Record<TrackType, PpctItemDraft[]>) {
  await ensureSchema()
  const name = subjectName.trim()
  if (!name) throw new Error('Nhập tên môn học.')
  if (!GRADES.includes(preview.grade as 10 | 11 | 12)) throw new Error('Khối không hợp lệ.')
  const hours = Math.max(1, weekly)
  const existing = await db.select().from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.name, name), eq(subjects.grade, preview.grade))).limit(1)
  let subjectId = existing[0]?.id
  if (subjectId) {
    await db.update(subjects).set({ weeklyPeriods: hours }).where(eq(subjects.id, subjectId))
  } else {
    const [row] = await db.insert(subjects).values({ userId, name, grade: preview.grade, weeklyPeriods: hours }).returning()
    subjectId = row.id
  }
  const savedTypes: string[] = []
  const skippedAll: number[] = []
  for (const type of ['chinh_khoa', 'chuyen_de'] as TrackType[]) {
    const [items, skipped] = uniquifyFromPosted(posted[type] || [])
    if (!items.length) continue
    await upsertTrack(userId, subjectId, type, TRACK_LABELS[type], items, preview.filename)
    savedTypes.push(`${TRACK_LABELS[type]} ${items.length} tiết`)
    skippedAll.push(...skipped)
  }
  if (!savedTypes.length) throw new Error('Không có dòng PPCT hợp lệ để lưu.')
  const cd = await db.select().from(ppctTracks).where(and(eq(ppctTracks.subjectId, subjectId), eq(ppctTracks.type, 'chuyen_de'))).limit(1)
  if (cd[0]) {
    const classList = await db.select().from(classes).where(and(eq(classes.userId, userId), eq(classes.subjectId, subjectId)))
    for (const cls of classList) {
      const found = await db.select().from(classElectives).where(and(eq(classElectives.classId, cls.id), eq(classElectives.trackId, cd[0].id))).limit(1)
      if (!found[0]) await db.insert(classElectives).values({ userId, classId: cls.id, trackId: cd[0].id, weeklyHours: 1 })
    }
  }
  return { savedTypes, skippedAll }
}

function uniquifyFromPosted(items: PpctItemDraft[]): [PpctItemDraft[], number[]] {
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

async function upsertTrack(userId: string, subjectId: number, type: TrackType, name: string, items: PpctItemDraft[], filename: string) {
  const existing = await db.select().from(ppctTracks).where(and(eq(ppctTracks.subjectId, subjectId), eq(ppctTracks.type, type))).limit(1)
  let trackId = existing[0]?.id
  if (trackId) {
    await db.update(lessons).set({ itemId: null }).where(sql`${lessons.itemId} IN (SELECT id FROM ppct_items WHERE track_id = ${trackId})`)
    await db.delete(ppctItems).where(eq(ppctItems.trackId, trackId))
    await db.update(ppctTracks).set({ name, lessonCount: items.length, sourceFile: filename, importedAt: new Date() }).where(eq(ppctTracks.id, trackId))
  } else {
    const [row] = await db.insert(ppctTracks).values({ userId, subjectId, type, name, lessonCount: items.length, sourceFile: filename }).returning()
    trackId = row.id
  }
  if (items.length) {
    await db.insert(ppctItems).values(items.map((item) => ({
      userId,
      trackId,
      period: item.tiet_so,
      title: item.bai_hoc,
      content: item.noi_dung_chi_tiet,
      requirement: item.yeu_cau_can_dat,
      warning: item.canh_bao,
    })))
  }
}

export async function updateSavedPpct(userId: string, subjectId: number, posted: Record<TrackType, PpctItemDraft[]>) {
  await ensureSchema()
  const subject = await db.select().from(subjects).where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId))).limit(1)
  if (!subject[0]) throw new Error('Không tìm thấy môn học.')
  const tracks = await db.select().from(ppctTracks).where(and(eq(ppctTracks.userId, userId), eq(ppctTracks.subjectId, subjectId)))
  if (!tracks.length) throw new Error('Môn này chưa có PPCT để sửa.')
  const updated: string[] = []
  for (const track of tracks) {
    const [items] = uniquifyFromPosted(posted[track.type as TrackType] || [])
    if (!items.length) continue
    await db.update(lessons).set({ itemId: null }).where(sql`${lessons.itemId} IN (SELECT id FROM ppct_items WHERE track_id = ${track.id})`)
    await db.delete(ppctItems).where(eq(ppctItems.trackId, track.id))
    await db.update(ppctTracks).set({ lessonCount: items.length, importedAt: new Date() }).where(eq(ppctTracks.id, track.id))
    await db.insert(ppctItems).values(items.map((item) => ({
      userId,
      trackId: track.id,
      period: item.tiet_so,
      title: item.bai_hoc,
      content: item.noi_dung_chi_tiet,
      requirement: item.yeu_cau_can_dat,
      warning: item.canh_bao,
    })))
    updated.push(`${track.type === 'chinh_khoa' ? 'Chính khóa' : 'Chuyên đề'} ${items.length} tiết`)
  }
  return updated
}

export async function addClass(userId: string, name: string, subjectId: number, teacherName: string) {
  await ensureSchema()
  const subject = await db.select().from(subjects).where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId))).limit(1)
  if (!subject[0]) throw new Error('Chọn môn–khối và nhập tên lớp.')
  const teacherId = await findOrCreateTeacher(userId, teacherName)
  const [row] = await db.insert(classes).values({ userId, name: name.trim(), grade: subject[0].grade, subjectId, teacherId }).returning()
  const cd = await db.select().from(ppctTracks).where(and(eq(ppctTracks.subjectId, subjectId), eq(ppctTracks.type, 'chuyen_de'))).limit(1)
  if (cd[0]) await db.insert(classElectives).values({ userId, classId: row.id, trackId: cd[0].id, weeklyHours: 1 })
  const setting = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)
  if (!setting[0]?.teacherName) await upsertSettings(userId, {
    schoolYear: setting[0]?.schoolYear || `${new Date().getFullYear()} – ${new Date().getFullYear() + 1}`,
    startDate: setting[0]?.startDate || mondayThisWeek(),
    totalWeeks: setting[0]?.totalWeeks || 35,
    teacherName,
  })
  return row
}

export async function assignTeacher(userId: string, classId: number, teacherName: string) {
  await ensureSchema()
  const cls = await db.select().from(classes).where(and(eq(classes.id, classId), eq(classes.userId, userId))).limit(1)
  if (!cls[0]) throw new Error('Không tìm thấy lớp.')
  const teacherId = await findOrCreateTeacher(userId, teacherName)
  await db.update(classes).set({ teacherId }).where(eq(classes.id, classId))
}

export async function assignElective(userId: string, classId: number, trackId: number, hours: number) {
  await ensureSchema()
  const cls = await db.select().from(classes).where(and(eq(classes.id, classId), eq(classes.userId, userId))).limit(1)
  const track = await db.select().from(ppctTracks).where(and(eq(ppctTracks.id, trackId), eq(ppctTracks.userId, userId))).limit(1)
  if (!cls[0] || !track[0]) throw new Error('Lớp hoặc chuyên đề không hợp lệ.')
  const existing = await db.select().from(classElectives).where(and(eq(classElectives.classId, classId), eq(classElectives.trackId, trackId))).limit(1)
  if (existing[0]) await db.update(classElectives).set({ weeklyHours: Math.max(1, hours) }).where(eq(classElectives.id, existing[0].id))
  else await db.insert(classElectives).values({ userId, classId, trackId, weeklyHours: Math.max(1, hours) })
}

export async function saveTimetable(userId: string, slots: Array<{ classId: number; day: number; session: string; period: number; type: TrackType }>, teacherId?: number) {
  await ensureSchema()
  const classList = await db.select().from(classes).where(eq(classes.userId, userId))
  const classMap = new Map(classList.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const incoming: Array<{ classId: number; day: number; session: string; period: number; type: string }> = []
  for (const slot of slots) {
    const cls = classMap.get(slot.classId)
    if (!cls) throw new Error('Lớp không tồn tại.')
    if (teacherId && cls.teacherId !== teacherId) throw new Error('Lớp không thuộc giáo viên đang xếp TKB.')
    const owner = cls.teacherId || 0
    const key = `${owner}|${slot.day}|${slot.session}|${slot.period}`
    if (seen.has(key)) throw new Error('Một giáo viên không thể gán hai lớp cùng một ô TKB.')
    seen.add(key)
    incoming.push({ classId: slot.classId, day: slot.day, session: slot.session, period: slot.period, type: slot.type === 'chuyen_de' ? 'chuyen_de' : 'chinh_khoa' })
  }
  const owned = teacherId ? classList.filter((c) => c.teacherId === teacherId).map((c) => c.id) : classList.map((c) => c.id)
  const existing = owned.length
    ? await db.select().from(timetableSlots).where(and(eq(timetableSlots.userId, userId), inArray(timetableSlots.classId, owned)))
    : []
  const remaining = [...incoming]
  const keepIds: number[] = []
  for (const slot of existing) {
    const idx = remaining.findIndex((s) => s.classId === slot.classId && s.day === slot.day && s.session === slot.session && s.period === slot.period)
    if (idx >= 0) {
      if (remaining[idx].type !== slot.type) await db.update(timetableSlots).set({ type: remaining[idx].type }).where(eq(timetableSlots.id, slot.id))
      keepIds.push(slot.id)
      remaining.splice(idx, 1)
    }
  }
  const dropIds = existing.filter((s) => !keepIds.includes(s.id)).map((s) => s.id)
  if (dropIds.length) await db.delete(timetableSlots).where(inArray(timetableSlots.id, dropIds))
  if (remaining.length) await db.insert(timetableSlots).values(remaining.map((s) => ({ userId, ...s })))
}

export async function generateYearSchedule(userId: string) {
  await ensureSchema()
  const setting = (await db.select().from(settings).where(eq(settings.userId, userId)).limit(1))[0]
  const weeks = Math.max(1, setting?.totalWeeks || 35)
  const start = setting?.startDate || mondayThisWeek()
  const [subjectRows, trackRows, itemRows, classRows, electiveRows, slotRows] = await Promise.all([
    db.select().from(subjects).where(eq(subjects.userId, userId)),
    db.select().from(ppctTracks).where(eq(ppctTracks.userId, userId)),
    db.select().from(ppctItems).where(eq(ppctItems.userId, userId)).orderBy(asc(ppctItems.period), asc(ppctItems.id)),
    db.select().from(classes).where(eq(classes.userId, userId)),
    db.select().from(classElectives).where(eq(classElectives.userId, userId)),
    db.select().from(timetableSlots).where(eq(timetableSlots.userId, userId)),
  ])
  const subjectMap = new Map(subjectRows.map((s) => [s.id, s]))
  const itemsByTrack = new Map<number, typeof itemRows>()
  for (const item of itemRows) {
    const list = itemsByTrack.get(item.trackId) || []
    list.push(item)
    itemsByTrack.set(item.trackId, list)
  }
  const coreBySubject = new Map<number, number>()
  for (const track of trackRows) if (track.type === 'chinh_khoa') coreBySubject.set(track.subjectId, track.id)
  const electiveByClass = new Map<number, { trackId: number; hours: number }>()
  for (const row of electiveRows) electiveByClass.set(row.classId, { trackId: row.trackId, hours: row.weeklyHours })

  const khoiProgress = new Map<string, number>()
  for (const track of trackRows) {
    const subject = subjectMap.get(track.subjectId)
    const items = itemsByTrack.get(track.id) || []
    if (!subject || !items.length) continue
    if (track.type === 'chinh_khoa') {
      let pointer = 0
      for (let w = 1; w <= weeks && pointer < items.length; w++) {
        for (let order = 1; order <= subject.weeklyPeriods && pointer < items.length; order++) {
          khoiProgress.set(`${subject.grade}|${track.id}|${w}|${order}`, items[pointer++].id)
        }
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
  const rows: Array<{ userId: string; slotId: number; classId: number; week: number; date: string; itemId: number | null; status: string }> = []
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
      rows.push({ userId, slotId: slot.id, classId: slot.classId, week, date: addDays(start, (week - 1) * 7 + (slot.day - 2)), itemId, status: 'Bình thường' })
    }
  }
  await db.delete(lessons).where(eq(lessons.userId, userId))
  const chunk = 200
  for (let i = 0; i < rows.length; i += chunk) await db.insert(lessons).values(rows.slice(i, i + chunk))
  return rows.length
}

export async function updateLesson(userId: string, lessonId: number, status: string, note: string, itemId: number | null) {
  await ensureSchema()
  if (!STATUSES.includes(status as StatusName)) throw new Error('Trạng thái giảng dạy không hợp lệ.')
  const lesson = (await db.select().from(lessons).where(and(eq(lessons.id, lessonId), eq(lessons.userId, userId))).limit(1))[0]
  if (!lesson) throw new Error('Không tìm thấy buổi dạy cần cập nhật.')
  const chosen = status === 'Nghỉ' ? null : itemId
  await db.update(lessons).set({ status, note: note.trim() || null, itemId: chosen }).where(eq(lessons.id, lessonId))
}

export { mondayThisWeek, addDays }
