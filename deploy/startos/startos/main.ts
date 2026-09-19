import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  agentPort,
  apiPort,
  appDir,
  appPort,
  assetsDir,
  csvList,
  postgresDb,
  postgresPort,
  postgresUser,
} from './utils'

const origin = (url: string) => new URL(url).origin

export const main = sdk.setupMain(async ({ effects }) => {
  const store = await storeJson.read().const(effects)
  if (!store) throw new Error('store.json has not been seeded')

  const urls = (await sdk.host
    .getOwn(effects, 'ui', (host) => {
      const address = host?.bindings[appPort]?.interfaces['ui']?.addressInfo
      if (!address) return { preferred: [], all: [] }
      return {
        preferred: address.public.format('urlstring'),
        all: address.nonLocal.format('urlstring'),
      }
    })
    .const()) ?? { preferred: [], all: [] }

  const origins = [...new Set(urls.all.map(origin))]
  const publicUrl =
    store.signIn.publicUrl ||
    urls.preferred.map(origin)[0] ||
    origins[0] ||
    `http://127.0.0.1:${appPort}`
  const appUrls = [...new Set([publicUrl, ...origins])]

  const allowedSignIn = [
    ...new Set([...csvList(store.signIn.allowedSignIn), store.admin.email]),
  ].filter(Boolean)

  const databaseUrl = `postgresql://${postgresUser}:${store.postgresPassword}@127.0.0.1:${postgresPort}/${postgresDb}`

  const google =
    store.signIn.googleClientId && store.signIn.googleClientSecret
      ? {
          GOOGLE_CLIENT_ID: store.signIn.googleClientId,
          GOOGLE_CLIENT_SECRET: store.signIn.googleClientSecret,
        }
      : {}

  const microsoft =
    store.signIn.microsoftClientId && store.signIn.microsoftClientSecret
      ? {
          MICROSOFT_CLIENT_ID: store.signIn.microsoftClientId,
          MICROSOFT_CLIENT_SECRET: store.signIn.microsoftClientSecret,
          ...(store.signIn.microsoftTenantId && {
            MICROSOFT_TENANT_ID: store.signIn.microsoftTenantId,
          }),
        }
      : {}

  const optional = (name: string, value: string) =>
    value ? { [name]: value } : {}

  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: store.authSecret,
    ALLOWED_SIGN_IN: allowedSignIn.join(','),
    PASSWORD_SIGN_IN: 'true',
    API_URL: publicUrl,
    API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    APP_URL: appUrls.join(','),
    AGENT_URL: `http://127.0.0.1:${agentPort}`,
    AGENT_BRIDGE_SECRET: store.bridgeSecret,
    CRON_SECRET: store.cronSecret,
    NEXT_TELEMETRY_DISABLED: '1',
    ...(store.agent.telemetry ? {} : { CRM_TELEMETRY_DISABLED: '1' }),
    ...google,
    ...microsoft,
    ...optional('AI_GATEWAY_API_KEY', store.agent.aiGatewayApiKey),
    ...optional('PERPLEXITY_API_KEY', store.agent.perplexityApiKey),
    ...optional('GITHUB_TOKEN', store.agent.githubToken),
    ...optional('BLOB_READ_WRITE_TOKEN', store.agent.blobToken),
  }

  const postgresSub = sdk.SubContainer.of(
    effects,
    { imageId: 'postgres' },
    sdk.Mounts.of().mountVolume({
      volumeId: 'main',
      subpath: 'postgresql',
      mountpoint: '/var/lib/postgresql',
      readonly: false,
    }),
    'postgres',
  )

  const crmSub = sdk.SubContainer.of(
    effects,
    { imageId: 'crm' },
    sdk.Mounts.of()
      .mountVolume({
        volumeId: 'main',
        subpath: 'agent/workflow-data',
        mountpoint: `${appDir}/apps/agent/.eve/.workflow-data`,
        readonly: false,
      })
      .mountVolume({
        volumeId: 'main',
        subpath: 'agent/sandbox-cache',
        mountpoint: `${appDir}/apps/agent/.eve/sandbox-cache`,
        readonly: false,
      })
      .mountAssets({ subpath: null, mountpoint: assetsDir }),
    'crm',
  )

  return sdk.Daemons.of(effects)
    .addDaemon('postgres', {
      subcontainer: postgresSub,
      exec: {
        command: sdk.useEntrypoint(['-c', 'listen_addresses=127.0.0.1']),
        env: {
          POSTGRES_USER: postgresUser,
          POSTGRES_PASSWORD: store.postgresPassword,
          POSTGRES_DB: postgresDb,
          PGDATA: '/var/lib/postgresql/data',
        },
      },
      ready: {
        display: null,
        fn: async () => {
          const { exitCode } = await postgresSub.exec([
            'pg_isready',
            '-q',
            '-h',
            '127.0.0.1',
            '-U',
            postgresUser,
            '-d',
            postgresDb,
          ])
          return exitCode === 0
            ? { result: 'success', message: i18n('PostgreSQL is ready') }
            : { result: 'loading', message: i18n('Waiting for PostgreSQL') }
        },
      },
      requires: [],
    })
    .addOneshot('migrate', {
      subcontainer: crmSub,
      exec: {
        command: ['bunx', 'prisma', 'migrate', 'deploy'],
        cwd: `${appDir}/packages/db`,
        env,
      },
      requires: ['postgres'],
    })
    .addOneshot('local-account', {
      subcontainer: crmSub,
      exec: {
        command: ['bun', 'scripts/local-account.ts'],
        cwd: `${appDir}/apps/api`,
        env: {
          ...env,
          LOCAL_ACCOUNT_EMAIL: store.admin.email,
          LOCAL_ACCOUNT_PASSWORD: store.admin.password,
        },
      },
      requires: ['migrate'],
    })
    .addDaemon('api', {
      subcontainer: crmSub,
      exec: {
        command: ['bun', 'dist/main.js'],
        cwd: `${appDir}/apps/api`,
        env: { ...env, PORT: String(apiPort) },
      },
      ready: {
        display: i18n('API'),
        fn: () =>
          sdk.healthCheck.checkWebUrl(
            effects,
            `http://127.0.0.1:${apiPort}/health`,
            {
              successMessage: i18n('The API is ready'),
              errorMessage: i18n('The API is not ready'),
            },
          ),
      },
      requires: ['local-account'],
    })
    .addDaemon('app', {
      subcontainer: crmSub,
      exec: {
        command: ['bun', 'run', 'start'],
        cwd: `${appDir}/apps/app`,
        env: { ...env, PORT: String(appPort) },
      },
      ready: {
        display: i18n('Web Interface'),
        gracePeriod: 60_000,
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, appPort, {
            successMessage: i18n('The web interface is ready'),
            errorMessage: i18n('The web interface is not ready'),
          }),
      },
      requires: ['api'],
    })
    .addDaemon('agent', {
      subcontainer: crmSub,
      exec: {
        command: ['bun', 'run', 'start'],
        cwd: `${appDir}/apps/agent`,
        env: { ...env, AGENT_PORT: String(agentPort) },
      },
      ready: {
        display: i18n('Research Agent'),
        gracePeriod: 60_000,
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, agentPort, {
            successMessage: i18n('The research agent is ready'),
            errorMessage: i18n('The research agent is not ready'),
          }),
      },
      requires: ['migrate'],
    })
    .addDaemon('scheduler', {
      subcontainer: crmSub,
      exec: {
        command: ['node', `${assetsDir}/scheduler.mjs`],
        cwd: appDir,
        env: {
          API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
          CRON_SECRET: store.cronSecret,
        },
      },
      ready: {
        display: null,
        fn: () => ({ result: 'success', message: null }),
      },
      requires: ['api'],
    })
})
