/**
 * Hand poses for character finger bones.
 * Applies relaxed rest pose or weapon grip pose to Quaternius rig finger bones
 * after animation mixer updates.
 */

import { Quaternion, Vector3, type Object3D, type Bone } from 'three';

export type HandPoseMode = 'rest' | 'grip';

interface FingerJointAngles {
  readonly deg01: number;
  readonly deg02: number;
  readonly deg03: number;
}

// Finger flex angles (in degrees) for relaxed rest pose (fingers slightly curled, natural rest)
const REST_FINGER_ANGLES: Record<string, FingerJointAngles> = {
  index: { deg01: 20, deg02: 25, deg03: 15 },
  middle: { deg01: 22, deg02: 28, deg03: 15 },
  ring: { deg01: 25, deg02: 30, deg03: 18 },
  pinky: { deg01: 28, deg02: 32, deg03: 20 },
};

// Finger flex angles (in degrees) for weapon grip pose (fingers wrapped round cylinder at palm socket)
const GRIP_FINGER_ANGLES: Record<string, FingerJointAngles> = {
  index: { deg01: 45, deg02: 60, deg03: 40 },
  middle: { deg01: 50, deg02: 65, deg03: 45 },
  ring: { deg01: 55, deg02: 70, deg03: 45 },
  pinky: { deg01: 60, deg02: 70, deg03: 45 },
};

// Pre-computed local quaternions
const Z_AXIS = new Vector3(0, 0, 1);
const RAD = Math.PI / 180;

function makeFlexQuat(deg: number, sign: number): Quaternion {
  return new Quaternion().setFromAxisAngle(Z_AXIS, deg * RAD * sign);
}

/**
 * Applies rest or grip finger pose to character model bones.
 * Call after mixer.update() each frame.
 */
export function applyHandPose(root: Object3D, mode: HandPoseMode = 'rest'): void {
  const angles = mode === 'grip' ? GRIP_FINGER_ANGLES : REST_FINGER_ANGLES;

  for (const side of ['_r', '_l'] as const) {
    const isRight = side === '_r';
    // For off-hand in grip mode, use relaxed pose
    const fingerAngles = (!isRight && mode === 'grip') ? REST_FINGER_ANGLES : angles;
    const sign = isRight ? 1 : -1;

    for (const [finger, config] of Object.entries(fingerAngles)) {
      const b01 = root.getObjectByName(`${finger}_01${side}`) as Bone | undefined;
      const b02 = root.getObjectByName(`${finger}_02${side}`) as Bone | undefined;
      const b03 = root.getObjectByName(`${finger}_03${side}`) as Bone | undefined;

      if (b01) b01.quaternion.copy(makeFlexQuat(config.deg01, sign));
      if (b02) b02.quaternion.copy(makeFlexQuat(config.deg02, sign));
      if (b03) b03.quaternion.copy(makeFlexQuat(config.deg03, sign));
    }

    // Thumb flex & rotation
    const th01 = root.getObjectByName(`thumb_01${side}`) as Bone | undefined;
    const th02 = root.getObjectByName(`thumb_02${side}`) as Bone | undefined;
    if (th01) {
      const thAngle = mode === 'grip' && isRight ? 35 : 18;
      th01.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(sign * 0.2, 0, 1).normalize(), thAngle * RAD * sign));
    }
    if (th02) {
      const thAngle = mode === 'grip' && isRight ? 30 : 12;
      th02.quaternion.copy(makeFlexQuat(thAngle, sign));
    }
  }
}
