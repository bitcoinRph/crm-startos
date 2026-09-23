import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.17.1:0',
  releaseNotes: {
    en_US:
      'Require human sessions for native authentication management. Fix API key creation with access profiles. Keep sales requests in the URL and open existing requests by ID. Fix the manual sales worker polling endpoint.',
    es_ES:
      'Exige sesiones humanas para gestionar la autenticación nativa. Corrige la creación de claves API con perfiles de acceso. Conserva las solicitudes de ventas en la URL y abre solicitudes existentes por ID. Corrige la consulta del proceso manual de ventas.',
    de_DE:
      'Native Authentifizierungsverwaltung erfordert eine Benutzersitzung. Korrigiert das Erstellen von API-Schlüsseln mit Zugriffsprofilen. Verkaufsanfragen bleiben in der URL und lassen sich per ID öffnen. Korrigiert die Abfrage des manuellen Vertriebsprozesses.',
    pl_PL:
      'Zarządzanie uwierzytelnianiem wymaga sesji użytkownika. Poprawia tworzenie kluczy API z profilami dostępu. Zachowuje żądania sprzedaży w adresie URL i otwiera istniejące żądania po ID. Poprawia odpytywanie ręcznego procesu sprzedaży.',
    fr_FR:
      'La gestion native de l’authentification exige une session utilisateur. Corrige la création des clés API avec profils d’accès. Conserve les demandes de vente dans l’URL et ouvre les demandes existantes par ID. Corrige l’interrogation du processus manuel de vente.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
