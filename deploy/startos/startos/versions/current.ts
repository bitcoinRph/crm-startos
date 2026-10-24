import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.20.0:0',
  releaseNotes: {
    en_US:
      'The CRM processes run as a non-root user. Contact photos and company logos are stored on the service volume and included in backups. API keys are rate-limited, and each key call is logged. Only an owner or an admin can permanently delete records. The deals list has saved views, a board, a weighted forecast and CSV export and import. A lead intake endpoint and an approval step before agent Slack posts are added. Existing data is migrated on start.',
    es_ES:
      'Los procesos del CRM se ejecutan con un usuario sin privilegios de root. Las fotos de contactos y los logotipos de empresas se guardan en el volumen del servicio y se incluyen en las copias de seguridad. Las claves de API tienen un límite de solicitudes y cada llamada queda registrada. Solo un propietario o un administrador puede eliminar registros de forma permanente. La lista de oportunidades tiene vistas guardadas, un tablero, una previsión ponderada y exportación e importación CSV. Se añaden un punto de entrada para clientes potenciales y una aprobación antes de que un agente publique en Slack. Los datos existentes se migran al iniciar.',
    de_DE:
      'Die CRM-Prozesse laufen als Benutzer ohne Root-Rechte. Kontaktfotos und Firmenlogos werden auf dem Dienst-Volume gespeichert und in Sicherungen aufgenommen. API-Schlüssel haben ein Anfragelimit, und jeder Aufruf wird protokolliert. Nur ein Eigentümer oder ein Administrator kann Datensätze endgültig löschen. Die Deal-Liste hat gespeicherte Ansichten, ein Board, eine gewichtete Prognose sowie CSV-Export und -Import. Ein Eingang für Leads und eine Freigabe vor Slack-Beiträgen von Agenten kommen hinzu. Vorhandene Daten werden beim Start migriert.',
    pl_PL:
      'Procesy CRM działają jako użytkownik bez uprawnień root. Zdjęcia kontaktów i logo firm są zapisywane na woluminie usługi i objęte kopiami zapasowymi. Klucze API mają limit zapytań, a każde wywołanie jest rejestrowane. Tylko właściciel lub administrator może trwale usuwać rekordy. Lista transakcji ma zapisane widoki, tablicę, prognozę ważoną oraz eksport i import CSV. Dodano punkt przyjmowania leadów i zatwierdzanie przed publikacją agenta w Slacku. Istniejące dane są migrowane przy uruchomieniu.',
    fr_FR:
      'Les processus du CRM s’exécutent avec un utilisateur sans droits root. Les photos des contacts et les logos des entreprises sont stockés sur le volume du service et inclus dans les sauvegardes. Les clés d’API sont limitées en débit et chaque appel est journalisé. Seul un propriétaire ou un administrateur peut supprimer définitivement des enregistrements. La liste des affaires propose des vues enregistrées, un tableau, une prévision pondérée et l’export et l’import CSV. Un point d’entrée pour les prospects et une approbation avant les messages Slack des agents sont ajoutés. Les données existantes sont migrées au démarrage.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
