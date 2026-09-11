'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import { headers } from 'next/headers'

export async function saveSettings(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const schoolYear = String(formData.get('schoolYear') || '').trim()
  const teacherName = String(formData.get('teacherName') || '').trim()
  const totalWeeks = Number(formData.get('totalWeeks'))
  if (!schoolYear || !teacherName || !Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 52) throw new Error('Invalid settings')
  return db.insert(settings).values({ userId: session.user.id, schoolYear, teacherName, totalWeeks }).returning()
}
