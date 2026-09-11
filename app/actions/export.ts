'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function exportReport(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const week = Number(formData.get('week'))
  if (!Number.isInteger(week) || week < 1 || week > 52) throw new Error('Invalid week')
  return { filename: `bao-cao-tuan-${week}.xlsx`, userId: session.user.id }
}
