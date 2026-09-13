import { redirect } from 'next/navigation'
import { getAppState } from '@/app/actions/data'
import { AppShell } from '@/components/app-shell'

export const dynamic = 'force-dynamic'

export default async function Page() {
  try {
    const state = await getAppState()
    return <AppShell initial={state} authEnabled={Boolean(process.env.DATABASE_URL)} />
  } catch (error) {
    if (process.env.DATABASE_URL && error instanceof Error && error.message === 'Unauthorized') redirect('/sign-in')
    throw error
  }
}
