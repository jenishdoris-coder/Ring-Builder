type Handedness = 'Left' | 'Right';
type Point = { x: number; y: number };

// A handedness label is anatomy, not palm/back visibility. Confirm a new
// label over several clear frames, then start a fresh attachment and fit.
export class HandIdentityTracker {
  private current: Handedness | null = null;
  private lastSeen = -Infinity;
  private missing = false;
  private clearPalmSign = 0;
  private candidate: { side: Handedness; since: number; frames: number; minimumScore: number } | null = null;

  update(label: Handedness | null, score: number, points: readonly Point[] | null, time: number, aspect = 1) {
    if (!points) {
      this.missing = true;
      this.candidate = null;
      return { handedness: this.current, reset: false, pending: false };
    }
    const reacquired = this.lastSeen === -Infinity || (this.missing && time - this.lastSeen > 300);
    this.missing = false;
    this.lastSeen = time;
    if (reacquired) { this.current = null; this.candidate = null; this.clearPalmSign = 0; }
    const wrist = points[0], index = points[5], pinky = points[17];
    let palmSign = 0, openness = 0;
    if (wrist && index && pinky) {
      const ix = index.x - wrist.x, iy = (index.y - wrist.y) * aspect;
      const px = pinky.x - wrist.x, py = (pinky.y - wrist.y) * aspect;
      const area = ix * py - iy * px;
      const palmLengthSq = ((ix + px) ** 2 + (iy + py) ** 2) / 4;
      if (Number.isFinite(area) && Number.isFinite(palmLengthSq)) {
        palmSign = Math.sign(area);
        openness = Math.abs(area) / Math.max(palmLengthSq, 1e-8);
      }
    }
    if (!this.current) {
      if (label && score >= 0.65) this.current = label;
      if (this.current && openness >= 0.25) this.clearPalmSign = palmSign;
      return { handedness: this.current, reset: reacquired || this.current !== null, pending: this.current === null };
    }
    if (!label || label === this.current || score < 0.65) {
      this.candidate = null;
      if (label === this.current && score >= 0.65 && openness >= 0.25) this.clearPalmSign = palmSign;
      return { handedness: this.current, reset: false, pending: false };
    }
    if (openness < 0.25) {
      // Edge-on anatomy is ambiguous; do not reinterpret a palm turn as a
      // different hand just because the classifier changes its mind.
      this.candidate = null;
      return { handedness: this.current, reset: false, pending: false };
    }
    // A cropped thumb can produce a stable 0.7-classified opposite hand. Using
    // the old label with that hand's reversed knuckle order puts the setting
    // on the palm. Accept that evidence slowly, requiring a clear order change;
    // a moderate label flicker on an unchanged palm cannot replace anatomy.
    if (score < 0.85 && (!this.clearPalmSign || palmSign === this.clearPalmSign)) {
      this.candidate = null;
      return { handedness: this.current, reset: false, pending: false };
    }
    if (!this.candidate || this.candidate.side !== label) {
      this.candidate = { side: label, since: time, frames: 1, minimumScore: score };
    } else {
      this.candidate.frames++;
      this.candidate.minimumScore = Math.min(this.candidate.minimumScore, score);
    }
    const clearLabel = this.candidate.minimumScore >= 0.85;
    if (this.candidate.frames >= (clearLabel ? 3 : 8) && time - this.candidate.since >= (clearLabel ? 180 : 650)) {
      this.current = label;
      this.clearPalmSign = palmSign;
      this.candidate = null;
      return { handedness: this.current, reset: true, pending: false };
    }
    return { handedness: this.current, reset: false, pending: this.candidate.frames >= 2 };
  }
}
