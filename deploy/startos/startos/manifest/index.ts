import { setupManifest } from '@start9labs/start-sdk'
import { long, ollamaDependency, short } from './i18n'

export const manifest = setupManifest({
  id: 'crm',
  title: 'CRM',
  license: 'MIT',
  packageRepo: 'https://github.com/bitcoinRph/crm-startos',
  upstreamRepo: 'https://github.com/trycompai/crm',
  marketingUrl: 'https://trycrm.ai/',
  donationUrl: null,
  description: { short, long },
  volumes: ['main'],
  images: {
    crm: {
      source: {
        dockerBuild: { workdir: '../..', dockerfile: '../../Dockerfile' },
      },
      arch: ['x86_64', 'aarch64'],
    },
    postgres: {
      source: { dockerTag: 'postgres:17.11-alpine' },
      arch: ['x86_64', 'aarch64'],
    },
  },
  dependencies: {
    ollama: {
      description: ollamaDependency,
      optional: true,
      s9pk: null,
    },
  },
})
