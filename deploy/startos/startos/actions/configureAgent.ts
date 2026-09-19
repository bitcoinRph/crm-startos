import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  aiGatewayApiKey: Value.text({
    name: i18n('Vercel AI Gateway key'),
    description: i18n(
      'The research agent reaches its model through the Vercel AI Gateway. Without a key the CRM works, but research sessions fail.',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  perplexityApiKey: Value.text({
    name: i18n('Perplexity API key'),
    description: i18n(
      'Lets the agent search the open web with citations. Queries send a name, an email domain and an employer to Perplexity.',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  githubToken: Value.text({
    name: i18n('GitHub token'),
    description: i18n(
      'Raises the rate limit when matching contacts to GitHub profiles. Any classic token with no scopes.',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  blobToken: Value.text({
    name: i18n('Vercel Blob token'),
    description: i18n(
      'Where logos and profile pictures are stored. Without it, contacts have no photograph and logos are hotlinked.',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  telemetry: Value.toggle({
    name: i18n('Anonymous usage telemetry'),
    description: i18n(
      'Send one daily event of counts to the upstream project. Off by default on StartOS.',
    ),
    default: false,
  }),
})

export const configureAgent = sdk.Action.withInput(
  'configure-agent',

  async () => ({
    name: i18n('Configure Research Agent'),
    description: i18n(
      'API keys the research agent uses. Every key is optional; each one adds a place it can look.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => storeJson.read((s) => s.agent).once(),

  async ({ effects, input }) =>
    storeJson.merge(effects, {
      agent: {
        aiGatewayApiKey: input.aiGatewayApiKey ?? '',
        perplexityApiKey: input.perplexityApiKey ?? '',
        githubToken: input.githubToken ?? '',
        blobToken: input.blobToken ?? '',
        telemetry: input.telemetry,
      },
    }),
)
