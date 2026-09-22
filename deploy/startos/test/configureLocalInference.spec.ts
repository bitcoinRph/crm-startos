import { describe, expect, test } from 'bun:test'
import { normalizeLocalInferenceInput } from '../startos/actions/configureLocalInference'

const saved = {
  modelId: 'qwen3.5:4b',
  maxOutputTokens: 1024,
}

describe('local inference action normalization', () => {
  test('an empty model ID clears the configuration', () => {
    expect(normalizeLocalInferenceInput({ modelId: ' ' })).toBeUndefined()
    expect(normalizeLocalInferenceInput({ modelId: null })).toBeUndefined()
    expect(normalizeLocalInferenceInput({})).toBeUndefined()
  })

  test('a model ID saves the trimmed configuration with the default output cap', () => {
    expect(
      normalizeLocalInferenceInput({ modelId: ` ${saved.modelId} ` }),
    ).toEqual(saved)
    expect(
      normalizeLocalInferenceInput({
        modelId: saved.modelId,
        maxOutputTokens: 768,
      }),
    ).toEqual({ ...saved, maxOutputTokens: 768 })
  })

  test('invalid input rejects without replacing the saved configuration', () => {
    for (const input of [
      { modelId: 'bad model' },
      { modelId: '-leading-dash' },
      { modelId: saved.modelId, maxOutputTokens: 0 },
      { modelId: saved.modelId, maxOutputTokens: 4096 },
      { modelId: saved.modelId, maxOutputTokens: 1.5 },
    ]) {
      let current = saved
      expect(() => {
        current = normalizeLocalInferenceInput(input) ?? current
      }).toThrow('Local inference configuration invalid')
      expect(current).toBe(saved)
    }
  })

  test('the endpoint is never an input', () => {
    expect(
      normalizeLocalInferenceInput({
        modelId: saved.modelId,
        ...({ baseURL: 'http://evil.example/v1' } as object),
      }),
    ).toEqual(saved)
  })
})
