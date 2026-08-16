import type { Bounds } from '../types/domain'

export const CAPTURE_DRAG_THRESHOLD = 8

export function isRegionDrag(bounds: Pick<Bounds, 'width' | 'height'>): boolean {
  return bounds.width >= CAPTURE_DRAG_THRESHOLD
    && bounds.height >= CAPTURE_DRAG_THRESHOLD
}
