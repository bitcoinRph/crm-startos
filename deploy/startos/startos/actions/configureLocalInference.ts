import { type LocalInference, storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { localInferenceMaxOutputTokens } from '../utils'

const { InputSpec, Value } = sdk

export type LocalInferenceActionInput = {
  modelId?: string | null
  maxOutputTokens?: number | null
}

const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

export function normalizeLocalInferenceInput(
  input: LocalInferenceActionInput,
): LocalInference | undefined {
  const modelId = input.modelId?.trim() ?? ''
  if (!modelId) return undefined

  const maxOutputTokens = input.maxOutputTokens ?? localInferenceMaxOutputTokens

  if (!modelIdPattern.test(modelId))
    throw new Error('Local inference configuration invalid: Invalid model ID')
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > localInferenceMaxOutputTokens
  )
    throw new Error(
      `Local inference configuration invalid: Max output tokens must be 1-${localInferenceMaxOutputTokens}`,
    )

  return { modelId, maxOutputTokens }
}

export const inputSpec = InputSpec.of({
  modelId: Value.text({
    name: i18n('Model ID'),
    description: i18n(
      'The model tag pulled in the Ollama service, for example qwen3.5:4b. Exact match. Leave empty to turn local inference off.',
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
  maxOutputTokens: Value.number({
    name: i18n('Max output tokens'),
    description: i18n(
      'Maximum tokens the model will generate per response. Must be between 1 and 1024.',
    ),
    required: false,
    default: localInferenceMaxOutputTokens,
    min: 1,
    max: localInferenceMaxOutputTokens,
    integer: true,
  }),
})

export const configureLocalInference = sdk.Action.withInput(
  'configure-local-inference',

  async () => ({
    name: i18n('Configure Local Inference'),
    description: i18n(
      'Run the research agent on the Ollama service installed on this server instead of the cloud gateway. Install Ollama from the marketplace, pull the model, then enter its ID here. Nothing falls back to the cloud.',
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
      modelId: agent?.modelId ?? null,
      maxOutputTokens: agent?.maxOutputTokens ?? localInferenceMaxOutputTokens,
    }
  },

  async ({ effects, input }) => {
    const configuration = normalizeLocalInferenceInput(input)
    await storeJson.merge(effects, {
      agent: { localInference: configuration },
    })
  },
)
