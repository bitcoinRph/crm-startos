import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.15.3:1',
  releaseNotes: {
    en_US: 'Smaller download. No change to the service itself.',
    es_ES: 'Descarga más pequeña. El servicio no cambia.',
    de_DE: 'Kleinerer Download. Der Dienst selbst ändert sich nicht.',
    pl_PL: 'Mniejszy plik do pobrania. Sama usługa bez zmian.',
    fr_FR: 'Téléchargement plus petit. Le service lui-même ne change pas.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
