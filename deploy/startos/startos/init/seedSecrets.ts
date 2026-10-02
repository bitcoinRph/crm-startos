import { utils } from '@start9labs/start-sdk'
import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'
import { hexCharset, secretCharset, secretsKeyLength } from '../utils'

const secret = (len: number) =>
  utils.getDefaultString({ charset: secretCharset, len })

export const seedSecrets = sdk.setupOnInit(async (effects, kind) => {
  await storeJson.merge(effects, {})

  const store = await storeJson.read().once()
  if (!store?.secretsKey)
    await storeJson.merge(effects, {
      secretsKey: utils.getDefaultString({
        charset: hexCharset,
        len: secretsKeyLength,
      }),
    })

  if (kind !== 'install') return

  await storeJson.merge(effects, {
    postgresPassword: secret(32),
    authSecret: secret(64),
    bridgeSecret: secret(48),
    cronSecret: secret(32),
  })
})
