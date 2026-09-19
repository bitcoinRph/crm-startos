import { utils } from '@start9labs/start-sdk'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { secretCharset } from '../utils'

const { InputSpec, Value } = sdk

const passwordLength = 24

export const inputSpec = InputSpec.of({
  email: Value.text({
    name: i18n('Email'),
    description: i18n(
      'The address you will sign in with. It is added to the sign-in allow-list automatically.',
    ),
    required: true,
    default: null,
    inputmode: 'email',
    patterns: [
      {
        regex: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
        description: i18n('Must be an email address'),
      },
    ],
  }),
  password: Value.text({
    name: i18n('Password'),
    description: i18n('Leave empty to generate one.'),
    required: false,
    default: null,
    masked: true,
    minLength: 12,
    generate: { charset: secretCharset, len: passwordLength },
  }),
})

export const setAdminCredentials = sdk.Action.withInput(
  'set-admin-credentials',

  async () => ({
    name: i18n('Set Sign-in Credentials'),
    description: i18n(
      'Create or reset the account you sign in with. The first account to sign in becomes the workspace owner.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => ({
    email: (await storeJson.read((s) => s.admin.email).once()) || undefined,
    password: null,
  }),

  async ({ effects, input }) => {
    const email = input.email.trim().toLowerCase()
    const password =
      input.password?.trim() ||
      utils.getDefaultString({ charset: secretCharset, len: passwordLength })

    await storeJson.merge(effects, { admin: { email, password } })

    return {
      version: '1',
      title: i18n('Sign-in Credentials'),
      message: i18n(
        'Use these on the sign-in page. The password is applied the next time the CRM starts.',
      ),
      result: {
        type: 'group',
        value: [
          {
            type: 'single',
            name: i18n('Email'),
            description: null,
            value: email,
            masked: false,
            copyable: true,
            qr: false,
          },
          {
            type: 'single',
            name: i18n('Password'),
            description: null,
            value: password,
            masked: true,
            copyable: true,
            qr: false,
          },
        ],
      },
    }
  },
)
