import { storeJson } from './fileModels/store.json'
import { sdk } from './sdk'
import { ollamaHealthCheck, ollamaVersionRange } from './utils'

export const setDependencies = sdk.setupDependencies(async ({ effects }) => {
  const localInference = await storeJson
    .read((s) => s.agent.localInference)
    .const(effects)

  if (!localInference) return {}

  return {
    ollama: {
      kind: 'running',
      versionRange: ollamaVersionRange,
      healthChecks: [ollamaHealthCheck],
    },
  }
})
