import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.19.0:1',
  releaseNotes: {
    en_US:
      'The StartOS package uses the approved symmetric logo. Application behavior and data remain unchanged.',
    es_ES:
      'El paquete de StartOS usa el logotipo simétrico aprobado. El comportamiento y los datos de la aplicación no cambian.',
    de_DE:
      'Das StartOS-Paket verwendet das freigegebene symmetrische Logo. Anwendungsverhalten und Daten bleiben unverändert.',
    pl_PL:
      'Pakiet StartOS używa zatwierdzonego symetrycznego logo. Działanie aplikacji i dane pozostają bez zmian.',
    fr_FR:
      'Le paquet StartOS utilise le logo symétrique approuvé. Le fonctionnement et les données de l’application restent inchangés.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
