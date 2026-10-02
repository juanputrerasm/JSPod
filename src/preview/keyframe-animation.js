/*
  Shared playback math for animated BINs and Nocturne DFM motions. Animated BIN frame
  alignment follows JSTrackViewer's keyframeMorphs convention.
*/

export function makePlayback(frameCount, fps, index = 0, playing = false) {
  const initial = wrapFrame(index, frameCount);
  return {
    frameCount,
    fps,
    index: initial,
    phase: initial,
    playing,
    lastTime: null,
    applyPose: null,
    showFrame: null,
    updateBar: null,
  };
}

export function advancePlayback(playback, time) {
  if (!playback?.playing || !playback.applyPose || playback.frameCount < 2) return;
  if (playback.lastTime === null) {
    playback.lastTime = time;
    return;
  }
  // A background tab can resume with a very large timestamp gap. Clamp that gap so the
  // first visible update remains a smooth continuation instead of jumping many frames.
  const elapsed = Math.min(0.1, Math.max(0, (time - playback.lastTime) / 1000));
  playback.lastTime = time;
  playback.phase = (playback.phase + elapsed * playback.fps) % playback.frameCount;
  const from = Math.floor(playback.phase);
  playback.applyPose(from, (from + 1) % playback.frameCount, playback.phase - from);
}

export function wrapFrame(index, count) {
  if (count < 1) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

/*
  Every decoded frame is shifted into the first frame's anchor space, then compatible
  meshes become absolute Three.js morph targets.
*/
export function keyframeMorphs(base, frames) {
  if (!base?.meshes?.length || frames.length < 2) return null;
  const baseAnchor = base.anchor ?? { x: 0, y: 0, z: 0 };
  const keyframes = [];
  for (const frame of frames) {
    if (!frame?.meshes || frame.meshes.length !== base.meshes.length) return null;
    const anchor = frame.anchor ?? { x: 0, y: 0, z: 0 };
    const dx = anchor.x - baseAnchor.x;
    const dy = anchor.y - baseAnchor.y;
    const dz = anchor.z - baseAnchor.z;
    const meshes = [];
    for (let meshIndex = 0; meshIndex < base.meshes.length; meshIndex++) {
      const source = frame.meshes[meshIndex];
      const baseMesh = base.meshes[meshIndex];
      if (source.positions.length !== baseMesh.positions.length || source.normals.length !== baseMesh.normals.length) return null;
      const positions = new Float32Array(source.positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = source.positions[i] + dx;
        positions[i + 1] = source.positions[i + 1] + dy;
        positions[i + 2] = source.positions[i + 2] + dz;
      }
      meshes.push({ positions, normals: source.normals });
    }
    keyframes.push({ meshes });
  }
  return keyframes;
}

export function setKeyframeBlend(influences, from, to, amount) {
  if (!influences) return;
  influences.fill(0);
  if (from > 0) influences[from - 1] += 1 - amount;
  if (to > 0) influences[to - 1] += amount;
}

/** Converts JSPod's Z-up intermediate coordinates to Three.js Y-up while interpolating. */
export function writeSwappedLerp(out, a, b, inverse, amount) {
  for (let i = 0; i < a.length; i += 3) {
    out[i] = a[i] * inverse + b[i] * amount;
    out[i + 1] = a[i + 2] * inverse + b[i + 2] * amount;
    out[i + 2] = -(a[i + 1] * inverse + b[i + 1] * amount);
  }
}
