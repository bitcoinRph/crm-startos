import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'
import { localInferenceMaxOutputTokens } from '../utils'

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

const localInferenceShape = z
  .object({
    modelId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
    maxOutputTokens: z.number().int().min(1).max(localInferenceMaxOutputTokens),
  })
  .strict()

const agentShape = z.object({
  aiGatewayApiKey: z.string().catch(''),
  perplexityApiKey: z.string().catch(''),
  githubToken: z.string().catch(''),
  blobToken: z.string().catch(''),
  telemetry: z.boolean().catch(false),
  localInference: localInferenceShape.optional().catch(undefined),
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
export type LocalInference = z.infer<typeof localInferenceShape>

export const storeJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: './store.json' },
  shape,
)
