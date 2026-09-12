'use server'

import { saveTimetable } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'
import type { TrackType } from '@/lib/ppct/constants'

export async function saveTimetableGrid(formData: FormData) {
  const user = await requireUser()
  const teacherIdRaw = Number(formData.get('teacherId') || 0)
  const teacherId = teacherIdRaw > 0 ? teacherIdRaw : undefined
  const slots = JSON.parse(String(formData.get('slots') || '[]')) as Array<{ classId: number; day: number; session: string; period: number; type: TrackType }>
  await saveTimetable(user.id, Array.isArray(slots) ? slots : [], teacherId)
}

export async function saveTimetableEntry(formData: FormData) {
  return saveTimetableGrid(formData)
}
