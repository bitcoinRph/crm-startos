import { i18n } from './i18n'
import { sdk } from './sdk'
import { appPort } from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const uiMulti = sdk.MultiHost.of(effects, 'ui')
  const uiMultiOrigin = await uiMulti.bindPort(appPort, {
    protocol: 'http',
  })

  const ui = sdk.createInterface(effects, {
    name: i18n('Web UI'),
    id: 'ui',
    description: i18n('The CRM web interface'),
    type: 'ui',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })

  const mcp = sdk.createInterface(effects, {
    name: i18n('MCP'),
    id: 'mcp',
    description: i18n(
      'Model Context Protocol endpoint for AI agents. Authenticate with a CRM API key from Settings.',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '/api/mcp',
    query: {},
  })

  return [await uiMultiOrigin.export([ui, mcp])]
})
