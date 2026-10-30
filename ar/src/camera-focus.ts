type FocusTrack = Pick<MediaStreamTrack, 'getCapabilities' | 'applyConstraints'>;
type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[] };
type FocusConstraints = MediaTrackConstraintSet & { focusMode: string };

export async function enableContinuousAutofocus(track: FocusTrack | undefined) {
  if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') return false;
  try {
    const capabilities = track.getCapabilities() as FocusCapabilities;
    if (!capabilities.focusMode?.includes('continuous')) return false;
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as FocusConstraints] });
    return true;
  } catch {
    // Camera focus controls are optional. Keep the stream available if a
    // browser advertises a mode but its camera driver rejects the request.
    return false;
  }
}
