import { sdk } from '../sdk'
import { configureAgent } from './configureAgent'
import { configureSignIn } from './configureSignIn'
import { setAdminCredentials } from './setAdminCredentials'

export const actions = sdk.Actions.of()
  .addAction(setAdminCredentials)
  .addAction(configureSignIn)
  .addAction(configureAgent)
