import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Fail the build when env is missing instead of shipping a hollow bundle.
 * src/lib/supabase.js throws at module scope without its env, rollup treats
 * that as an unconditional throw and dead-code-eliminates the app, and the
 * deploy is a blank page that built green. The only tell is bundle size.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k])
  if (missing.length && mode === 'production') {
    throw new Error(
      `Missing ${missing.join(', ')}. Refusing to build a hollow bundle. ` +
        'Locally: cp .env.example .env and fill it in. In CI: check the repo secrets.',
    )
  }
  return { plugins: [react()], base: process.env.BASE_URL || '/' }
})
