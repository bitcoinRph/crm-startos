import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  allowedSignIn: Value.text({
    name: i18n('Who may sign in'),
    description: i18n(
      'Comma-separated email domains or single addresses, for example "acme.com" or "you@gmail.com". The credentials email is always allowed.',
    ),
    required: false,
    default: null,
    placeholder: 'acme.com, partner@example.com',
  }),
  publicUrl: Value.text({
    name: i18n('Public URL'),
    description: i18n(
      'The address Google or Microsoft redirect to after sign-in. Leave empty to use the first address of the Web UI interface. Google refuses .local addresses, so set a real domain here for Google sign-in.',
    ),
    required: false,
    default: null,
    placeholder: 'https://crm.example.com',
    patterns: [
      {
        regex: '^https?://[^\\s/]+$',
        description: i18n('Must be an origin like https://crm.example.com'),
      },
    ],
  }),
  googleClientId: Value.text({
    name: i18n('Google client ID'),
    description: i18n(
      'A Google OAuth web client. Enables Google sign-in and Gmail and Calendar sync. Set both Google values or neither.',
    ),
    required: false,
    default: null,
  }),
  googleClientSecret: Value.text({
    name: i18n('Google client secret'),
    description: null,
    required: false,
    default: null,
    masked: true,
  }),
  microsoftClientId: Value.text({
    name: i18n('Microsoft client ID'),
    description: i18n(
      'A Microsoft Entra app registration. Enables Microsoft sign-in and Outlook sync. Set both Microsoft values or neither.',
    ),
    required: false,
    default: null,
  }),
  microsoftClientSecret: Value.text({
    name: i18n('Microsoft client secret'),
    description: null,
    required: false,
    default: null,
    masked: true,
  }),
  microsoftTenantId: Value.text({
    name: i18n('Microsoft tenant'),
    description: i18n(
      'Leave empty for "common". Set your tenant GUID to refuse every other tenant at Microsoft.',
    ),
    required: false,
    default: null,
  }),
})

export const configureSignIn = sdk.Action.withInput(
  'configure-sign-in',

  async () => ({
    name: i18n('Configure Sign-in'),
    description: i18n(
      'The sign-in allow-list, the public URL and the optional Google and Microsoft sign-in providers.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => storeJson.read((s) => s.signIn).once(),

  async ({ effects, input }) =>
    storeJson.merge(effects, {
      signIn: {
        allowedSignIn: input.allowedSignIn ?? '',
        publicUrl: input.publicUrl ?? '',
        googleClientId: input.googleClientId ?? '',
        googleClientSecret: input.googleClientSecret ?? '',
        microsoftClientId: input.microsoftClientId ?? '',
        microsoftClientSecret: input.microsoftClientSecret ?? '',
        microsoftTenantId: input.microsoftTenantId ?? '',
      },
    }),
)
