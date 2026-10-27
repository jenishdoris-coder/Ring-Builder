/** Wheel zoom eases towards a bounded radius instead of applying each notch immediately. */
export class DampedRingZoom {
  private controls: any;
  private targetRadius?: number;
  private cursor?: { x: number; y: number };
  readonly responseTime = .16;

  get active() { return this.targetRadius !== undefined; }

  stop() {
    this.targetRadius = undefined;
    this.controls = undefined;
    this.cursor = undefined;
  }

  add(delta: number, camera: any, controls: any, cursor?: { x: number; y: number }) {
    if (!controls?.enabled || controls.enableZoom === false || !camera.isPerspectiveCamera || !Number.isFinite(delta)) return false;
    const radius = camera.position.distanceTo(controls.target);
    if (!Number.isFinite(radius) || radius <= 0) return false;
    if (this.controls !== controls || this.targetRadius === undefined) this.targetRadius = radius;
    this.controls = controls;
    this.cursor = controls.zoomToCursor ? cursor : undefined;
    const minimum = Math.max(.001, controls.minDistance || .001);
    const maximum = Math.max(minimum, controls.maxDistance ?? Infinity);
    // Match OrbitControls' notch sensitivity while smoothing its application.
    this.targetRadius = Math.min(maximum, Math.max(minimum,
      (this.targetRadius ?? radius) * Math.exp(Math.max(-240, Math.min(240, delta)) * .00051293294 * (controls.zoomSpeed ?? 1))));
    return true;
  }

  advance(camera: any, controls: any, deltaTime: number) {
    if (this.targetRadius === undefined) return false;
    if (this.controls !== controls || !controls.enabled || controls.enableZoom === false) { this.stop(); return false; }
    const target = controls.target;
    const radius = camera.position.distanceTo(target);
    if (!Number.isFinite(radius) || radius <= 0) { this.stop(); return false; }
    const minimum = Math.max(.001, controls.minDistance || .001);
    const maximum = Math.max(minimum, controls.maxDistance ?? Infinity);
    const destination = Math.min(maximum, Math.max(minimum, this.targetRadius));
    const difference = Math.log(destination / radius);
    const settled = Math.abs(difference) < .0001;
    const amount = 1 - Math.exp(-Math.max(0, Math.min(.05, deltaTime)) / this.responseTime);
    const next = settled ? destination : radius * Math.exp(difference * amount);
    if (Math.abs(next - radius) > 1e-9) {
      if (this.cursor) {
        camera.updateMatrixWorld();
        const ray = camera.position.clone().set(this.cursor.x, this.cursor.y, 1).unproject(camera).sub(camera.position).normalize();
        const forward = camera.getWorldDirection(camera.position.clone());
        camera.position.addScaledVector(ray, radius - next);
        target.copy(camera.position).addScaledVector(forward, next);
      } else {
        camera.position.sub(target).multiplyScalar(next / radius).add(target);
      }
    }
    if (settled) this.stop();
    return Math.abs(next - radius) > 1e-9;
  }
}
