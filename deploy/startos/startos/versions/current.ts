import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.23.0:0',
  releaseNotes: {
    en_US:
      'Every change to a company, contact, deal or custom field is now recorded, with who made it: a person, an API key, the CRM agent or the system. Each record has a Changes tab, and each API key lists the changes it made. A person can undo a change to a record field, its stage or its archive state, unless the field changed again since. Agents read the same history through the record_history tool. Old entries follow the archive retention setting. The update adds one database migration, which runs on start.',
    es_ES:
      'Ahora se registra cada cambio en una empresa, un contacto, una oportunidad o un campo personalizado, con quién lo hizo: una persona, una clave de API, el agente del CRM o el sistema. Cada registro tiene una pestaña Cambios, y cada clave de API lista los cambios que hizo. Una persona puede deshacer un cambio en un campo del registro, su etapa o su estado de archivo, salvo que el campo haya cambiado después. Los agentes leen el mismo historial con la herramienta record_history. Las entradas antiguas siguen el ajuste de retención del archivo. La actualización añade una migración de la base de datos, que se ejecuta al iniciar.',
    de_DE:
      'Jede Änderung an einer Firma, einem Kontakt, einem Deal oder einem benutzerdefinierten Feld wird jetzt mit dem Urheber aufgezeichnet: eine Person, ein API-Schlüssel, der CRM-Agent oder das System. Jeder Datensatz hat einen Tab Änderungen, und jeder API-Schlüssel listet seine Änderungen. Eine Person kann eine Änderung an einem Feld des Datensatzes, seiner Phase oder seinem Archivstatus rückgängig machen, sofern sich das Feld seitdem nicht erneut geändert hat. Agenten lesen denselben Verlauf mit dem Werkzeug record_history. Alte Einträge folgen der Archiv-Aufbewahrung. Das Update fügt eine Datenbankmigration hinzu, die beim Start läuft.',
    pl_PL:
      'Każda zmiana firmy, kontaktu, szansy sprzedaży lub pola niestandardowego jest teraz zapisywana wraz z autorem: osobą, kluczem API, agentem CRM lub systemem. Każdy rekord ma kartę Zmiany, a każdy klucz API pokazuje zmiany, które wprowadził. Osoba może cofnąć zmianę pola rekordu, jego etapu lub stanu archiwizacji, o ile pole nie zmieniło się ponownie. Agenci czytają tę samą historię narzędziem record_history. Stare wpisy podlegają ustawieniu przechowywania archiwum. Aktualizacja dodaje jedną migrację bazy danych, która działa przy starcie.',
    fr_FR:
      'Chaque modification d’une entreprise, d’un contact, d’une affaire ou d’un champ personnalisé est désormais enregistrée, avec son auteur : une personne, une clé d’API, l’agent du CRM ou le système. Chaque fiche a un onglet Modifications, et chaque clé d’API liste les modifications qu’elle a faites. Une personne peut annuler une modification d’un champ de la fiche, de son étape ou de son archivage, sauf si le champ a changé depuis. Les agents lisent le même historique avec l’outil record_history. Les anciennes entrées suivent le réglage de conservation des archives. La mise à jour ajoute une migration de base de données, exécutée au démarrage.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
