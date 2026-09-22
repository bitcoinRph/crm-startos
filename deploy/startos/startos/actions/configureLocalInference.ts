import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

export type LocalInferenceActionInput = {
  baseURL?: string | null
  modelId?: string | null
  contextWindowTokens?: number | null
  maxOutputTokens?: number | null
}

export type LocalInferenceConfiguration = {
  baseURL: string
  modelId: string
  contextWindowTokens: 4096
  maxOutputTokens: number
}

export function normalizeLocalInferenceInput(
  input: LocalInferenceActionInput,
): LocalInferenceConfiguration | undefined {
  const baseURL = input.baseURL?.trim() ?? ''
  const modelId = input.modelId?.trim() ?? ''
  if (!baseURL && !modelId) return undefined
  if (!baseURL || !modelId)
    throw new Error('Endpoint and model ID must be set together')

  const contextWindowTokens = input.contextWindowTokens ?? 4096
  const maxOutputTokens = input.maxOutputTokens ?? 1024

  try {
    const url = new URL(baseURL)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['ollama.embassy', 'localhost', '127.0.0.1', '[::1]'].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/v1' ||
      baseURL !== url.href
    ) {
      throw new Error('Invalid endpoint')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId))
      throw new Error('Invalid model ID')
    if (contextWindowTokens !== 4096)
      throw new Error('Context window must be 4096')
    if (maxOutputTokens < 1 || maxOutputTokens > 1024)
      throw new Error('Max output tokens must be 1-1024')
    if (maxOutputTokens >= contextWindowTokens)
      throw new Error('Max output must be less than context window')
  } catch (err) {
    throw new Error(
      `Local inference configuration invalid: ${err instanceof Error ? err.message : 'unknown error'}`,
    )
  }

  return { baseURL, modelId, contextWindowTokens: 4096, maxOutputTokens }
}

export const inputSpec = InputSpec.of({
  baseURL: Value.text({
    name: i18n('Local inference endpoint'),
    description: i18n(
      'HTTP(S) URL to an OpenAI-compatible local inference server. Only ollama.embassy, localhost, 127.0.0.1 and [::1] are allowed. No credentials or query parameters.',
    ),
    required: false,
    default: null,
    patterns: [
      {
        regex:
          '^https?://(ollama\\.embassy|localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?/v1$',
        description: i18n(
          'Must be an approved local /v1 endpoint without credentials or query parameters.',
        ),
      },
    ],
  }),
  modelId: Value.text({
    name: i18n('Model ID'),
    description: i18n(
      'The model identifier passed to the local server. Exact match required. No spaces.',
    ),
    required: false,
    default: null,
    patterns: [
      {
        regex: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$',
        description: i18n(
          'Model ID must start with a letter or number and contain only letters, numbers, dots, underscores, colons, slashes and hyphens.',
        ),
      },
    ],
  }),
  contextWindowTokens: Value.number({
    name: i18n('Context window tokens'),
    description: i18n(
      'The exact context window size the runner allocates. Must be 4096 for the verified Qwen profile.',
    ),
    required: false,
    default: 4096,
    min: 4096,
    max: 4096,
    integer: true,
  }),
  maxOutputTokens: Value.number({
    name: i18n('Max output tokens'),
    description: i18n(
      'Maximum tokens the model will generate per response. Must be between 1 and 1024.',
    ),
    required: false,
    default: 1024,
    min: 1,
    max: 1024,
    integer: true,
  }),
})

export const configureLocalInference = sdk.Action.withInput(
  'configure-local-inference',

  async () => ({
    name: i18n('Configure Local Inference'),
    description: i18n(
      'Connect the research agent to a local model server instead of the cloud gateway. The server must already be running and the model pre-loaded. No cloud fallback exists.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => {
    const agent = await storeJson.read((s) => s.agent.localInference).once()
    return {
      baseURL: agent?.baseURL ?? null,
      modelId: agent?.modelId ?? null,
      contextWindowTokens: agent?.contextWindowTokens ?? 4096,
      maxOutputTokens: agent?.maxOutputTokens ?? 1024,
    }
  },

  async ({ effects, input }) => {
    const configuration = normalizeLocalInferenceInput(input)
    if (!configuration) {
      await storeJson.merge(effects, {
        agent: { localInference: undefined },
      })
      return
    }

    await storeJson.merge(effects, {
      agent: {
        localInference: configuration,
      },
    })
  },
)
