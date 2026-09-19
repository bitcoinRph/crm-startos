import { setAdminCredentials } from '../actions/setAdminCredentials'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

export const watchAdminCredentials = sdk.setupOnInit(async (effects) => {
  const admin = await storeJson.read((s) => s.admin).const(effects)

  if (!admin?.email || !admin.password) {
    await sdk.action.createOwnTask(effects, setAdminCredentials, 'critical', {
      reason: i18n('Create the first account before the CRM starts'),
    })
  }
})
