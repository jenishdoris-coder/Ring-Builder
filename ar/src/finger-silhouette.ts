type Point = { x: number; y: number };
export type PixelImage = { width: number; height: number; data: ArrayLike<number> };
// A conservative image-quality score, not a probability of correct segmentation.
export const MIN_FINGER_EDGE_CONFIDENCE = 0.72;
export type FingerEdgeReason = 'clear' | 'weak contrast' | 'competing edges' | 'inconsistent sections' | 'boundary too close';
export type FingerSilhouette = {
  left: Point; right: Point; width: number; support: number;
  confidence: number; reason: FingerEdgeReason;
  sections: { left: Point; right: Point }[];
};
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

// Sample several cross-sections on either side of the attachment. Measuring
// one row made a palm crease, shadow, or one noisy pixel control ring size.
export function findFingerSilhouette(
  image: PixelImage, base: Point, tip: Point,
  neighbors: { base: Point; tip: Point }[] = [], position = 0.53,
  calibrated?: { width: number; offset?: number },
): FingerSilhouette | null {
  const primary = findFingerSilhouetteAt(image, base, tip, neighbors, position, calibrated);
  if (!calibrated || !(calibrated.width > 0) || primary && primary.confidence >= MIN_FINGER_EDGE_CONFIDENCE
    || Math.hypot(tip.x - base.x, tip.y - base.y) < calibrated.width * 0.75) return primary;
  // Webbing and overlapping neighbors can hide the lower cross-sections while
  // the same proximal finger has clear boundaries nearer its first joint.
  // A calibrated fit may use that independently observed contour; a shadow,
  // missing side, or large disagreement cannot supply an alternate diameter.
  const distalPosition = Math.min(0.72, position + 0.18);
  const distal = findFingerSilhouetteAt(image, base, tip, neighbors, distalPosition, calibrated);
  if (!distal || distal.confidence < MIN_FINGER_EDGE_CONFIDENCE || distal.support < 3
    || distal.width < calibrated.width * 0.7 || distal.width > calibrated.width * 1.35) return primary;
  const shift = distalPosition - position;
  const move = (p: Point) => ({ x: p.x - (tip.x - base.x) * shift, y: p.y - (tip.y - base.y) * shift });
  return { ...distal, left: move(distal.left), right: move(distal.right) };
}

function findFingerSilhouetteAt(
  image: PixelImage, base: Point, tip: Point,
  neighbors: { base: Point; tip: Point }[] = [], position = 0.53,
  calibrated?: { width: number; offset?: number },
): FingerSilhouette | null {
  const dx = tip.x - base.x, dy = tip.y - base.y;
  const length = Math.hypot(dx, dy);
  if (length < 12) return null;
  const ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const origin = { x: base.x + dx * position, y: base.y + dy * position };
  const sample = (x: number, y: number, channel: number) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 1 || iy < 1 || ix >= image.width - 1 || iy >= image.height - 1) return NaN;
    return image.data[(iy * image.width + ix) * 4 + channel];
  };
  const sections: {
    left: number; right: number; cx: number; cy: number;
    contrast: number; ambiguity: number; nearBoundary: boolean; colorVerified: boolean;
  }[] = [];
  for (const station of [-0.18, -0.12, -0.06, 0.06, 0.12, 0.18]) {
    const cx = origin.x + dx * station, cy = origin.y + dy * station;
    // The projected bone shortens when the hand tilts; the calibrated finger
    // diameter does not. Keep room to observe its actual boundaries on a turn.
    const searchRadius = Math.max(length * 0.62, (calibrated?.width ?? 0) * 0.75);
    let lower = -searchRadius, upper = searchRadius;
    for (const neighbor of neighbors) {
      const t = position + station;
      const qx = neighbor.base.x + (neighbor.tip.x - neighbor.base.x) * t;
      const qy = neighbor.base.y + (neighbor.tip.y - neighbor.base.y) * t;
      const across = (qx - cx) * nx + (qy - cy) * ny;
      if (across < 0) lower = Math.max(lower, across * 0.60);
      else upper = Math.min(upper, across * 0.60);
    }
    // Follow color connected to the finger center, rather than selecting the
    // strongest keyboard/shadow gradient. Normalized color is less sensitive
    // to skin highlights and shading than brightness alone. If color is not
    // distinctive or either boundary is unobserved, keep the gradient fallback.
    const colorAt = (at: number) => {
      const rgb = [0, 1, 2].map(c => [-1, 0, 1].reduce((sum, row) =>
        sum + sample(cx + nx * at + ux * row, cy + ny * at + uy * row, c), 0) / 3);
      const sum = rgb[0] + rgb[1] + rgb[2];
      return Number.isFinite(sum) && sum > 30 ? rgb.map(v => v / sum) : null;
    };
    const seedColors = [-0.07, 0, 0.07].map(at => colorAt(at * length));
    const seed = seedColors.every(p => p !== null)
      ? [0, 1, 2].map(c => median(seedColors.map(p => p![c]))) : null;
    const colorDistance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
    const seedVariation = seed ? Math.max(...seedColors.map(p => p ? colorDistance(p, seed) : Infinity)) : Infinity;
    const distinctive = seed && Math.max(...seed) - Math.min(...seed) > 0.04 && seedVariation < 0.025;
    const colorThreshold = Math.max(0.025, seedVariation * 3 + 0.01);
    const sameHue = (color: number[], reference: number[]) => {
      const a = color.map(v => v - 1 / 3), b = reference.map(v => v - 1 / 3);
      const al = Math.hypot(...a), bl = Math.hypot(...b);
      // Shading changes chroma strength across a palm, even after brightness
      // normalization. Follow its hue to the background, not that inner ramp.
      return al > Math.max(0.012, bl * 0.25)
        && a.reduce((sum, v, i) => sum + v * b[i], 0) / Math.max(al * bl, 1e-8) > 0.92;
    };
    const colorBoundary = (direction: number, limit: number) => {
      if (!distinctive || !seed) return null;
      let outside = 0, firstOutside = 0;
      for (let at = 1; at <= Math.abs(limit); at++) {
        const color = colorAt(at * direction);
        if (!color) return null;
        if (colorDistance(color, seed) > colorThreshold && !sameHue(color, seed)) {
          if (!outside) firstOutside = at;
          if (++outside === 3) return (firstOutside - 0.5) * direction;
        } else outside = 0;
      }
      return null;
    };
    const colorLeft = colorBoundary(-1, lower), colorRight = colorBoundary(1, upper);
    const candidates = (start: number, end: number) => {
      const values: { at: number; strength: number; direction: number }[] = [];
      for (let at = Math.ceil(start); at <= Math.floor(end); at++) {
        let strength = 0, direction = 0;
        for (let c = 0; c < 3; c++) {
          // Average along the finger, compare both sides of the boundary.
          let before = 0, after = 0;
          for (let row = -1; row <= 1; row++) {
            before += sample(cx + nx * (at - 2) + ux * row, cy + ny * (at - 2) + uy * row, c);
            after += sample(cx + nx * (at + 2) + ux * row, cy + ny * (at + 2) + uy * row, c);
          }
          strength += Math.abs(after - before) / 9;
          direction += (after - before) / 9;
        }
        if (Number.isFinite(strength) && strength > 14) values.push({ at, strength, direction });
      }
      // Merge a gradient plateau into one boundary. Otherwise one physical
      // edge produces several competing peaks and a pixel-dependent position.
      const peaks: { at: number; strength: number }[] = [];
      for (let i = 0; i < values.length;) {
        let weighted = 0, weight = 0, strength = 0;
        let j = i;
        do {
          weighted += values[j].at * values[j].strength;
          weight += values[j].strength;
          strength = Math.max(strength, values[j].strength);
          j++;
        } while (j < values.length && values[j].at - values[j - 1].at <= 1
          && values[j].direction * values[j - 1].direction >= 0);
        peaks.push({ at: weighted / weight, strength });
        i = j;
      }
      return peaks.sort((a, b) => b.strength - a.strength).slice(0, 6);
    };
    const left = candidates(lower, -length * 0.13);
    const right = candidates(length * 0.13, upper);
    const pairs: { left: number; right: number; score: number; contrast: number }[] = [];
    for (const a of left) for (const b of right) {
      const width = b.at - a.at, offset = (a.at + b.at) / 2;
      if (width < length * 0.3 || width > Math.max(length * 1.12, (calibrated?.width ?? 0) * 1.4)
        || Math.abs(offset) > width * 0.25) continue;
      const score = Math.sqrt(a.strength * b.strength) / (1 + Math.abs(offset) / width);
      pairs.push({ left: a.at, right: b.at, score, contrast: Math.min(a.strength, b.strength) });
    }
    pairs.sort((a, b) => b.score - a.score);
    const colorPairs = colorLeft !== null && colorRight !== null ? pairs.filter(p => {
      const tolerance = Math.max(3, (colorRight - colorLeft) * 0.08);
      return Math.abs(p.left - colorLeft) < tolerance && Math.abs(p.right - colorRight) < tolerance;
    }) : [];
    // Skin and a warm desk can have the same hue while their chroma differs
    // sharply at the physical boundary. A previous calibrated diameter can
    // corroborate that pair, but only when both actual gradients also separate
    // locally sampled inside/outside colors. The prior supplies no new edges.
    const localBoundary = (p: typeof pairs[number], requireChromaDrop: boolean) => {
      if (!seed || !distinctive) return false;
      const width = p.right - p.left;
      const step = Math.max(3, Math.min(6, width * 0.07));
      const boundary = (at: number, direction: number) => {
        const inside = colorAt(at - direction * step), outside = colorAt(at + direction * step);
        const middle = colorAt(at + direction * (step + 1));
        const farther = colorAt(at + direction * (step + 2));
        if (!inside || !outside || !middle || !farther || !sameHue(inside, seed)
          || colorDistance(inside, outside) <= 0.025 || colorDistance(inside, farther) <= 0.02) return false;
        const chroma = (color: number[]) => Math.hypot(...color.map(v => v - 1 / 3));
        const hueChanged = (color: number[]) => {
          const a = inside.map(v => v - 1 / 3), b = color.map(v => v - 1 / 3);
          return a.reduce((sum, v, i) => sum + v * b[i], 0)
            / Math.max(Math.hypot(...a) * Math.hypot(...b), 1e-8) < 0.99;
        };
        // Saturation alone cannot distinguish a warm cast shadow from skin.
        // Require two adjacent outward pixels with independently changed hue.
        // The gradient's weighted subpixel position can put the first sample
        // on the antialiased skin edge; the remaining two must still observe
        // persistent background color. A width prior supplies no hue evidence.
        if (!(hueChanged(outside) && hueChanged(middle)
          || hueChanged(middle) && hueChanged(farther))) return false;
        // A further neighbor reverses this transition (wood into skin). A
        // diameter prior must not certify that opposite-facing background edge.
        return chroma(outside) < chroma(inside) * (requireChromaDrop ? 0.65 : 0.85)
          && chroma(farther) < chroma(inside) * (requireChromaDrop ? 0.7 : 0.9);
      };
      return boundary(p.left, -1) && boundary(p.right, 1);
    };
    // The broad skin-hue tolerance also includes warm desks. Local persistent
    // hue changes plus bilateral chroma drops can observe the outer transition
    // without a fit prior. Bright/dark skin with the same hue stays ambiguous.
    const chromaPairs = pairs.filter(p => localBoundary(p, true));
    const calibratedPairs = calibrated && calibrated.width > 0 ? pairs.filter(p => {
      const width = p.right - p.left, offset = (p.left + p.right) / 2;
      return width >= calibrated.width * 0.7 && width <= calibrated.width * 1.35
        && Math.abs(offset - (calibrated.offset ?? 0)) <= Math.max(3, calibrated.width * 0.18)
        && localBoundary(p, false);
    }).sort((a, b) => {
      const score = (p: typeof a) => p.score / (1 + Math.abs((p.right - p.left) / calibrated.width - 1) * 4
        + Math.abs((p.left + p.right) / 2 - (calibrated.offset ?? 0)) / calibrated.width * 4);
      return score(b) - score(a);
    }) : [];
    const calibratedVerified = calibratedPairs.length > 0;
    const colorVerified = colorPairs.length > 0 || calibratedVerified || chromaPairs.length > 0;
    const best = colorPairs[0] ?? calibratedPairs[0] ?? chromaPairs[0] ?? pairs[0];
    if (best) {
      const separation = Math.max(4, (best.right - best.left) * 0.08);
      const alternative = pairs.find(p => Math.abs(p.left - best.left) > separation || Math.abs(p.right - best.right) > separation);
      // A strong internal highlight can be consistent along the whole finger.
      // Additional outward boundaries are evidence against trusting it, even
      // when those outer boundaries have lower contrast than the highlight.
      const outwardLeft = left.some(p => p.at < best.left - separation);
      const outwardRight = right.some(p => p.at > best.right + separation);
      const bilateralAlternative = pairs.some(p => p.score > best.score * 0.75
        && Math.abs(p.left - best.left) > separation && Math.abs(p.right - best.right) > separation);
      // A strong brightness edge is not a silhouette when the pixels beyond
      // it still have the finger's hue (a cast shadow, or a skin-colored desk).
      // Retain candidates for guides, but do not let them recalibrate the fit.
      const outsideStep = Math.max(4, (best.right - best.left) * 0.08);
      const leftOutside = colorAt(best.left - outsideStep);
      const rightOutside = colorAt(best.right + outsideStep);
      const colorConflict = !!distinctive && !!seed && !colorVerified && (
        !!leftOutside && sameHue(leftOutside, seed) || !!rightOutside && sameHue(rightOutside, seed)
        || colorLeft !== null && Math.abs(best.left - colorLeft) > separation
        || colorRight !== null && Math.abs(best.right - colorRight) > separation);
      // A background/shadow transition on one side is common with spread
      // fingers. Penalize it, but reserve the veto for ambiguous pairs on
      // both sides (for example a bright strip inside the finger).
      const ambiguity = colorVerified ? 0.92 : colorConflict || outwardLeft && outwardRight || bilateralAlternative ? 0.4
        : outwardLeft || outwardRight || !!alternative && alternative.score > best.score * 0.75 ? 0.8 : 1;
      const nearImageEdge = (at: number) => {
        const x = cx + nx * at, y = cy + ny * at;
        return x < 4 || y < 4 || x > image.width - 5 || y > image.height - 5;
      };
      sections.push({ ...best, cx, cy,
        colorVerified,
        // A corroborating color transition remains useful in dim scenes;
        // requiring daylight brightness contrast discarded correct palm edges.
        contrast: best.contrast * (colorVerified ? 35 / 22 : 1),
        ambiguity,
        nearBoundary: best.left - lower < (colorVerified ? 1 : 3) || upper - best.right < (colorVerified ? 1 : 3)
          || nearImageEdge(best.left) || nearImageEdge(best.right),
      });
    }
  }
  if (!sections.length) return null;
  // Webbing or a nearby neighbor can clip an individual scan. Fit from
  // the remaining sections when at least four have complete boundaries.
  const usable = sections.filter(s => !s.nearBoundary);
  // Three complete, bilateral color-confirmed contours can refine an existing
  // diameter when the remaining scans hit webbing. Keep a lower confidence and
  // require longer temporal confirmation downstream; gradients alone cannot do it.
  const partialWidth = usable.length === 3 ? median(usable.map(s => s.right - s.left)) : 0;
  const partialOffset = usable.length === 3 ? median(usable.map(s => (s.left + s.right) / 2)) : 0;
  const partialColorSupport = !!calibrated && usable.length === 3
    && partialWidth >= calibrated.width * 0.7 && partialWidth <= calibrated.width * 1.35
    && usable.every(s => s.colorVerified && s.ambiguity >= 0.9 && s.contrast >= 28
      && Math.abs((s.right - s.left) / partialWidth - 1) < 0.06
      && Math.abs((s.left + s.right) / 2 - partialOffset) < partialWidth * 0.06);
  const measured = usable.length >= 4 || partialColorSupport ? usable : sections;
  const middleWidth = median(measured.map(s => s.right - s.left));
  const middleOffset = median(measured.map(s => (s.left + s.right) / 2));
  const consistent = measured.filter(s => Math.abs((s.right - s.left) / middleWidth - 1) < 0.16 && Math.abs((s.left + s.right) / 2 - middleOffset) < middleWidth * 0.12);
  if (!consistent.length) return null;
  const left = median(consistent.map(s => s.left)), right = median(consistent.map(s => s.right));
  const spread = median(measured.map(s => Math.abs(s.right - s.left - middleWidth))) / middleWidth;
  const checks: { confidence: number; reason: FingerEdgeReason }[] = [
    { confidence: clamp(median(consistent.map(s => s.contrast)) / 35), reason: 'weak contrast' },
    { confidence: Math.min(consistent.length < 4 ? partialColorSupport && consistent.length === 3 ? 0.78 : 0.4 : 1,
      consistent.length / measured.length, clamp(1 - spread / 0.2)), reason: 'inconsistent sections' },
    { confidence: [...consistent].sort((a, b) => a.ambiguity - b.ambiguity)[Math.floor((consistent.length - 1) / 2)].ambiguity, reason: 'competing edges' },
    { confidence: consistent.some(s => s.nearBoundary) ? 0.4 : 1, reason: 'boundary too close' },
  ];
  const weakest = checks.reduce((a, b) => a.confidence <= b.confidence ? a : b);
  return {
    left: { x: origin.x + nx * left, y: origin.y + ny * left },
    right: { x: origin.x + nx * right, y: origin.y + ny * right },
    width: right - left,
    support: consistent.length,
    confidence: weakest.confidence,
    reason: weakest.confidence >= MIN_FINGER_EDGE_CONFIDENCE ? 'clear' : weakest.reason,
    sections: sections.map(s => ({
      left: { x: s.cx + nx * s.left, y: s.cy + ny * s.left },
      right: { x: s.cx + nx * s.right, y: s.cy + ny * s.right },
    })),
  };
}
