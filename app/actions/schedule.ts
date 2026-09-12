'use server'

import { generateYearSchedule, updateLesson } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'

export async function generateSchedule() {
  const user = await requireUser()
  const count = await generateYearSchedule(user.id)
  return { count }
}

export async function updateLessonStatus(formData: FormData) {
  const user = await requireUser()
  const lessonId = Number(formData.get('lessonId'))
  const status = String(formData.get('status') || 'Bình thường')
  const note = String(formData.get('note') || '')
  const itemRaw = Number(formData.get('itemId') || 0)
  if (!Number.isInteger(lessonId) || lessonId < 1) throw new Error('Không tìm thấy buổi dạy.')
  await updateLesson(user.id, lessonId, status, note, itemRaw > 0 ? itemRaw : null)
}
