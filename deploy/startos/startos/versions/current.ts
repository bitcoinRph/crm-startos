import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.18.0:0',
  releaseNotes: {
    en_US:
      'Each user can connect their own ChatGPT account (Codex device sign-in) or an OpenAI API key in Settings. Research conversations then run on the chosen Codex model, alongside Ollama. Sales requests on the crm-codex or crm-ollama profile are now processed inside the CRM and wait for your approval. Credentials are encrypted with a key this package generates.',
    es_ES:
      'Cada usuario puede conectar su propia cuenta de ChatGPT (inicio de sesión de Codex por dispositivo) o una clave API de OpenAI en Ajustes. Las conversaciones de investigación usan entonces el modelo de Codex elegido, junto a Ollama. Las solicitudes de ventas con el perfil crm-codex o crm-ollama se procesan ahora dentro del CRM y esperan tu aprobación. Las credenciales se cifran con una clave que genera este paquete.',
    de_DE:
      'Jeder Benutzer kann in den Einstellungen sein eigenes ChatGPT-Konto (Codex-Geräteanmeldung) oder einen OpenAI-API-Schlüssel verbinden. Recherche-Unterhaltungen laufen dann auf dem gewählten Codex-Modell, neben Ollama. Verkaufsanfragen mit dem Profil crm-codex oder crm-ollama werden jetzt im CRM verarbeitet und warten auf Ihre Genehmigung. Zugangsdaten werden mit einem von diesem Paket erzeugten Schlüssel verschlüsselt.',
    pl_PL:
      'Każdy użytkownik może w Ustawieniach połączyć własne konto ChatGPT (logowanie urządzenia Codex) lub klucz API OpenAI. Rozmowy badawcze działają wtedy na wybranym modelu Codex, obok Ollamy. Żądania sprzedaży z profilem crm-codex lub crm-ollama są teraz przetwarzane w CRM i czekają na Twoją akceptację. Dane logowania są szyfrowane kluczem generowanym przez ten pakiet.',
    fr_FR:
      'Chaque utilisateur peut connecter son propre compte ChatGPT (connexion Codex par appareil) ou une clé API OpenAI dans les Réglages. Les conversations de recherche utilisent alors le modèle Codex choisi, en plus d’Ollama. Les demandes de vente avec le profil crm-codex ou crm-ollama sont désormais traitées dans le CRM et attendent votre approbation. Les identifiants sont chiffrés avec une clé générée par ce paquet.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
