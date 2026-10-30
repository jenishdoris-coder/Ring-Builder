import { Quaternion } from 'three';
import type { HandPoint, RingPlacement } from './ring-tracking';

export type RecordedHand = {
  viewport: { width: number; height: number };
  video: { width: number; height: number };
  hand: { landmarks: HandPoint[] };
  rendered: { x: number; y: number; width: number; orientation: number[];
    fingerLength: number; handScale: number; imageDepthScale?: number };
};

/** Recenter a saved tracking frame without changing the relative hand depth,
 * finger opening, or orientation. The live mask builder handles this replay. */
export function replayRecordedHand(capture: RecordedHand, width: number, height: number) {
  const fit = Math.max(capture.viewport.width / capture.video.width, capture.viewport.height / capture.video.height);
  const scale = Math.min(width, height) * .32 / capture.rendered.width;
  const x = width * .5, y = height * .48;
  const screen = capture.hand.landmarks.map(point => ({
    x: x + ((capture.viewport.width - capture.video.width * fit) / 2 + point.x * capture.video.width * fit - capture.rendered.x) * scale,
    y: y + ((capture.viewport.height - capture.video.height * fit) / 2 + point.y * capture.video.height * fit - capture.rendered.y) * scale,
  }));
  const placement: RingPlacement = {
    x, y, width: capture.rendered.width * scale,
    orientation: new Quaternion().fromArray(capture.rendered.orientation).normalize(),
    fingerLength: capture.rendered.fingerLength * scale, handScale: capture.rendered.handScale * scale,
    imageDepthScale: capture.rendered.imageDepthScale ? capture.rendered.imageDepthScale * scale : undefined,
    surfaceFacing: -1, anchors: [],
  };
  return { placement, mask: { landmarks: capture.hand.landmarks, screen, width, height, mode: 'environment' as const } };
}
