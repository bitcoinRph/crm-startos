const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001'
const secret = process.env.CRON_SECRET

if (!secret) {
  console.error('[scheduler] CRON_SECRET is not set; nothing to do')
  process.exit(1)
}

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const jobs = [
  { path: '/internal/sync/mailboxes', every: 5 * minute },
  { path: '/internal/sync/rates', every: day },
  { path: '/internal/telemetry/rollup', every: day },
  { path: '/internal/tracking/retention', every: day },
  { path: '/internal/archive/prune', every: day },
]

async function run(job) {
  try {
    const response = await fetch(`${api}${job.path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10 * minute),
    })
    console.log(`[scheduler] ${job.path} -> ${response.status}`)
  } catch (error) {
    console.error(`[scheduler] ${job.path} failed: ${error.message}`)
  }
}

for (const job of jobs) {
  setTimeout(() => {
    void run(job)
    setInterval(() => void run(job), job.every)
  }, minute)
}

console.log(`[scheduler] ${jobs.length} routes scheduled against ${api}`)
