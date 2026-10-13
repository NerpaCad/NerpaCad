import { describe, expect, it } from 'vitest'
import { emptyDoc } from '@/core/doc/model'
import { DEFAULT_VIEW, PRESETS, QUALITY, lowerQuality, normView, stepDown, sunDirection } from '@/core/robotics/look'
import { parseDoc, serializeDoc } from '@/core/io/formats'

describe('the beautiful view settings', () => {
  it('are made valid from anything', () => {
    expect(normView(undefined)).toEqual(DEFAULT_VIEW)
    expect(normView({ on: true, time: 'night', sun: 725, glow: 250, quality: 'ultra', shadows: false })).toEqual({
      on: true,
      time: 'night',
      sun: 5,
      shadows: false,
      glow: 100,
      quality: 'mid'
    })
    expect(normView({ sun: -30, glow: NaN }).sun).toBe(330)
    expect(normView({ glow: NaN }).glow).toBe(DEFAULT_VIEW.glow)
  })

  it('a slow computer only ever lowers the quality', () => {
    expect(stepDown('high')).toBe('mid')
    expect(stepDown('low')).toBe('low')
    expect(lowerQuality('high', 'mid')).toBe('mid')
    expect(lowerQuality('low', 'high')).toBe('low')
    expect(QUALITY.low.ao).toBe(false)
    expect(QUALITY.high.shadowMap).toBeGreaterThan(QUALITY.low.shadowMap)
  })

  it('the sun stands where the slider says, low in the evening', () => {
    const [x, y, z] = sunDirection({ ...DEFAULT_VIEW, sun: 90, time: 'day' })
    expect(Math.abs(x)).toBeLessThan(1e-9)
    expect(y).toBeGreaterThan(0)
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9)
    expect(sunDirection({ ...DEFAULT_VIEW, time: 'evening' })[2]).toBeLessThan(sunDirection({ ...DEFAULT_VIEW, time: 'day' })[2])
    expect(PRESETS.night.sunIntensity).toBeLessThan(PRESETS.day.sunIntensity / 5)
  })

  it('are kept in the project file', () => {
    const d = { ...emptyDoc(), view: { ...DEFAULT_VIEW, on: true, time: 'evening' as const, quality: 'high' as const } }
    expect(parseDoc(serializeDoc(d)).view).toEqual(d.view)
    expect(parseDoc(serializeDoc(emptyDoc())).view).toBeUndefined()
  })
})
