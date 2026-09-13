export async function requireUser() {
  if (!process.env.DATABASE_URL) {
    return { id: 'local', name: 'Giáo viên', email: 'local@ppct.local' }
  }
  const { auth } = await import('@/lib/auth')
  const { headers } = await import('next/headers')
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session.user
}

export function isLocalMode() {
  return !process.env.DATABASE_URL
}
