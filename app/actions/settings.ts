'use server'

import { upsertSettings } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'

export async function saveSettings(formData: FormData) {
  const user = await requireUser()
  const schoolYear = String(formData.get('schoolYear') || '').trim()
  const teacherName = String(formData.get('teacherName') || '').trim()
  const startDate = String(formData.get('startDate') || '').trim()
  const totalWeeks = Number(formData.get('totalWeeks'))
  if (!schoolYear || !startDate || !Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 52) throw new Error('Invalid settings')
  await upsertSettings(user.id, { schoolYear, startDate, totalWeeks, teacherName })
}
