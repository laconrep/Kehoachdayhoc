import type { ImportPreview, PpctItemDraft } from './types'
import type { TrackType } from './constants'

async function impl() {
  if (process.env.DATABASE_URL) return import('./store')
  return import('./file-store')
}

export async function loadState(userId: string, userName?: string) {
  return (await impl()).loadState(userId, userName)
}

export async function upsertSettings(userId: string, data: { schoolYear: string; startDate: string; totalWeeks: number; teacherName: string }) {
  return (await impl()).upsertSettings(userId, data)
}

export async function saveImport(userId: string, preview: ImportPreview, subjectName: string, weekly: number, posted: Record<TrackType, PpctItemDraft[]>) {
  return (await impl()).saveImport(userId, preview, subjectName, weekly, posted)
}

export async function updateSavedPpct(userId: string, subjectId: number, posted: Record<TrackType, PpctItemDraft[]>) {
  return (await impl()).updateSavedPpct(userId, subjectId, posted)
}

export async function addClass(userId: string, name: string, subjectId: number, teacherName: string) {
  return (await impl()).addClass(userId, name, subjectId, teacherName)
}

export async function assignTeacher(userId: string, classId: number, teacherName: string) {
  return (await impl()).assignTeacher(userId, classId, teacherName)
}

export async function assignElective(userId: string, classId: number, trackId: number, hours: number) {
  return (await impl()).assignElective(userId, classId, trackId, hours)
}

export async function saveTimetable(userId: string, slots: Array<{ classId: number; day: number; session: string; period: number; type: TrackType }>, teacherId?: number) {
  return (await impl()).saveTimetable(userId, slots, teacherId)
}

export async function generateYearSchedule(userId: string) {
  return (await impl()).generateYearSchedule(userId)
}

export async function updateLesson(userId: string, lessonId: number, status: string, note: string, itemId: number | null) {
  return (await impl()).updateLesson(userId, lessonId, status, note, itemId)
}
