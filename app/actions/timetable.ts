'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { timetableEntries } from '@/lib/db/schema'
import { headers } from 'next/headers'

export async function saveTimetableEntry(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const classId = Number(formData.get('classId'))
  const period = Number(formData.get('period'))
  const day = String(formData.get('day') || '').trim()
  const studySession = String(formData.get('session') || '').trim()
  const subject = String(formData.get('subject') || '').trim()
  if (!Number.isInteger(classId) || classId < 1 || !Number.isInteger(period) || period < 1 || period > 5 || !day || !studySession || !subject) throw new Error('Invalid timetable entry')
  return db.insert(timetableEntries).values({ userId: session.user.id, classId, day, session: studySession, period, subject }).returning()
}
