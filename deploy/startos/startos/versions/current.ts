import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.17.0:0',
  releaseNotes: {
    en_US:
      'Backups work again. Local inference runs on the Ollama service installed on this server (optional dependency). API keys carry a profile: full access, read only, or read and propose. Agents file sales proposals over MCP that you approve on the new Sales page.',
    es_ES:
      'Las copias de seguridad vuelven a funcionar. La inferencia local usa el servicio Ollama instalado en este servidor (dependencia opcional). Las claves de API tienen un perfil: acceso completo, solo lectura, o lectura y propuestas. Los agentes envían propuestas de ventas por MCP que apruebas en la nueva página Ventas.',
    de_DE:
      'Backups funktionieren wieder. Lokale Inferenz läuft über den auf diesem Server installierten Ollama-Dienst (optionale Abhängigkeit). API-Schlüssel tragen ein Profil: Vollzugriff, nur lesen, oder lesen und vorschlagen. Agenten reichen Verkaufsvorschläge über MCP ein, die Sie auf der neuen Seite Vertrieb genehmigen.',
    pl_PL:
      'Kopie zapasowe znów działają. Lokalna inferencja korzysta z usługi Ollama zainstalowanej na tym serwerze (zależność opcjonalna). Klucze API mają profil: pełny dostęp, tylko odczyt, albo odczyt i propozycje. Agenci składają propozycje sprzedażowe przez MCP, które zatwierdzasz na nowej stronie Sprzedaż.',
    fr_FR:
      'Les sauvegardes fonctionnent à nouveau. L’inférence locale utilise le service Ollama installé sur ce serveur (dépendance facultative). Les clés d’API portent un profil : accès complet, lecture seule, ou lecture et proposition. Les agents déposent des propositions commerciales via MCP que vous approuvez sur la nouvelle page Ventes.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
