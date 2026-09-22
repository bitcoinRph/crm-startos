import { describe, expect, test } from 'bun:test'
import { normalizeLocalInferenceInput } from '../startos/actions/configureLocalInference'

const saved = {
  baseURL: 'http://ollama.embassy:11434/v1',
  modelId: 'qwen3.5:4b',
  contextWindowTokens: 4096 as const,
  maxOutputTokens: 1024,
}

describe('local inference action normalization', () => {
  test('empty identity clears configuration', () => {
    expect(
      normalizeLocalInferenceInput({ baseURL: ' ', modelId: null }),
    ).toBeUndefined()
  })

  test('partial identity rejects without replacing saved configuration', () => {
    for (const input of [
      { baseURL: saved.baseURL, modelId: ' ' },
      { baseURL: null, modelId: saved.modelId },
    ]) {
      let current = saved
      expect(() => {
        current = normalizeLocalInferenceInput(input) ?? current
      }).toThrow('Endpoint and model ID must be set together')
      expect(current).toBe(saved)
    }
  })

  test('valid identity saves normalized configuration', () => {
    expect(
      normalizeLocalInferenceInput({
        baseURL: ` ${saved.baseURL} `,
        modelId: ` ${saved.modelId} `,
        contextWindowTokens: 4096,
        maxOutputTokens: 768,
      }),
    ).toEqual({ ...saved, maxOutputTokens: 768 })
  })

  test('invalid complete input rejects without replacing saved configuration', () => {
    for (const input of [
      { ...saved, baseURL: 'https://example.com/v1' },
      { ...saved, modelId: 'bad model' },
      { ...saved, contextWindowTokens: 8192 },
      { ...saved, maxOutputTokens: 0 },
    ]) {
      let current = saved
      expect(() => {
        current = normalizeLocalInferenceInput(input) ?? current
      }).toThrow('Local inference configuration invalid')
      expect(current).toBe(saved)
    }
  })
})
