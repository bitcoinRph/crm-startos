import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

const adminShape = z.object({
  email: z.string().catch(''),
  password: z.string().catch(''),
})

const signInShape = z.object({
  allowedSignIn: z.string().catch(''),
  publicUrl: z.string().catch(''),
  googleClientId: z.string().catch(''),
  googleClientSecret: z.string().catch(''),
  microsoftClientId: z.string().catch(''),
  microsoftClientSecret: z.string().catch(''),
  microsoftTenantId: z.string().catch(''),
})

const agentShape = z.object({
  aiGatewayApiKey: z.string().catch(''),
  perplexityApiKey: z.string().catch(''),
  githubToken: z.string().catch(''),
  blobToken: z.string().catch(''),
  telemetry: z.boolean().catch(false),
  localInference: z
    .object({
      baseURL: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value)
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            ['ollama.embassy', 'localhost', '127.0.0.1', '[::1]'].includes(
              url.hostname,
            ) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === '/v1' &&
            value === url.href
          )
        }, 'Use an approved local /v1 endpoint without credentials or query parameters.'),
      modelId: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
      contextWindowTokens: z
        .number()
        .int()
        .refine((value) => value === 4096),
      maxOutputTokens: z.number().int().min(1).max(1024),
    })
    .strict()
    .refine((value) => value.maxOutputTokens < value.contextWindowTokens)
    .optional(),
})

const shape = z.object({
  postgresPassword: z.string().catch(''),
  authSecret: z.string().catch(''),
  bridgeSecret: z.string().catch(''),
  cronSecret: z.string().catch(''),
  admin: adminShape.catch(() => adminShape.parse({})),
  signIn: signInShape.catch(() => signInShape.parse({})),
  agent: agentShape.catch(() => agentShape.parse({})),
})

export type Store = z.infer<typeof shape>

export const storeJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: './store.json' },
  shape,
)
