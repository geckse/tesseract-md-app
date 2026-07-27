import { describe, expect, it } from 'vitest'
import {
  aspectRatioForPreset,
  centeredCropForAspect,
  clampCropRect,
  cropPixelDimensions,
  outputDimensions,
  resizeWithAspect,
  rotateRecipe,
  type ImageEditRecipe
} from '../../src/shared/image-edit'

const identity: ImageEditRecipe = {
  rotation: 0,
  crop: null,
  width: null,
  height: null
}

describe('image edit recipe math', () => {
  it('swaps output axes and remaps a crop across quarter turns', () => {
    const recipe: ImageEditRecipe = {
      rotation: 0,
      crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      width: 300,
      height: 200
    }

    expect(rotateRecipe(recipe, 'right')).toEqual({
      rotation: 90,
      crop: { x: 0.4, y: 0.1, width: 0.4, height: 0.3 },
      width: 200,
      height: 300
    })
  })

  it('calculates rotated, cropped and resized dimensions in order', () => {
    const recipe: ImageEditRecipe = {
      rotation: 90,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.25 },
      width: null,
      height: null
    }
    expect(cropPixelDimensions(1200, 800, recipe)).toEqual({ width: 400, height: 300 })
    expect(outputDimensions(1200, 800, { ...recipe, width: 200, height: 120 })).toEqual({
      width: 200,
      height: 120
    })
  })

  it('clamps crop rectangles without changing their selected size', () => {
    expect(clampCropRect({ x: 0.9, y: -0.2, width: 0.4, height: 0.5 })).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 0.5
    })
  })

  it('creates centered crops for common pixel aspect ratios', () => {
    expect(centeredCropForAspect(1, 1600, 900)).toEqual({
      x: 0.21875,
      y: 0,
      width: 0.5625,
      height: 1
    })
    expect(aspectRatioForPreset('original', 1200, 800, 90)).toBeCloseTo(2 / 3)
    expect(aspectRatioForPreset('16:9', 1200, 800, 0)).toBeCloseTo(16 / 9)
    expect(aspectRatioForPreset('free', 1200, 800, 0)).toBeNull()
  })

  it('links resize axes to the cropped aspect ratio', () => {
    expect(resizeWithAspect('width', 800, 4 / 3)).toEqual({ width: 800, height: 600 })
    expect(resizeWithAspect('height', 720, 16 / 9)).toEqual({ width: 1280, height: 720 })
    expect(outputDimensions(10, 20, identity)).toEqual({ width: 10, height: 20 })
  })
})
