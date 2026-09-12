'use server'

import { loadState } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'

export async function getAppState() {
  const user = await requireUser()
  return loadState(user.id, user.name || '')
}
