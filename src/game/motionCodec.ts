import { create } from '@bufbuild/protobuf'
import { MotionSampleSchema, type MotionSample } from '../gen/game_pb.ts'
import { dequantize, type MotionPacket } from '../puzzle/kinematics.ts'

/**
 * `MotionPacket` position/velocity/accel are already MOTION_Q quanta
 * (`MotionSender.emit`). Do not call `quantize` again or the server sees
 * coordinates ~32× too large and observers paint the piece off-table.
 */
export function packetToSample(packet: MotionPacket): MotionSample {
  return create(MotionSampleSchema, {
    hide: packet.hide,
    anchor: packet.anchor,
    absolute: packet.abs,
    xQ: Math.round(packet.x),
    yQ: Math.round(packet.y),
    dtMs: Math.max(0, Math.round(packet.dt)),
    vxQ: Math.round(packet.vx),
    vyQ: Math.round(packet.vy),
    axQ: Math.round(packet.ax),
    ayQ: Math.round(packet.ay),
    clientTimeMs: Math.max(0, Math.round(performance.now())),
  })
}

/** Proto sample → pixel-space packet for local paint / cursor overlay. */
export function sampleToPacket(sample: MotionSample): MotionPacket {
  return {
    hide: sample.hide,
    anchor: sample.anchor,
    abs: sample.absolute,
    x: dequantize(sample.xQ),
    y: dequantize(sample.yQ),
    dt: sample.dtMs,
    vx: dequantize(sample.vxQ),
    vy: dequantize(sample.vyQ),
    ax: dequantize(sample.axQ),
    ay: dequantize(sample.ayQ),
  }
}
