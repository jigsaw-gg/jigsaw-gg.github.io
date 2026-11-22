import { fromBinary, toBinary } from '@bufbuild/protobuf'
import { StreamFrameSchema, type StreamFrame } from './gen/game_pb.ts'

export function encodeStreamFrame(frame: StreamFrame): Uint8Array {
  const body = toBinary(StreamFrameSchema, frame)
  const out = new Uint8Array(4 + body.byteLength)
  new DataView(out.buffer).setUint32(0, body.byteLength)
  out.set(body, 4)
  return out
}

export class StreamFrameReader {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return
    const next = new Uint8Array(this.buf.byteLength + chunk.byteLength)
    next.set(this.buf, 0)
    next.set(chunk, this.buf.byteLength)
    this.buf = next
  }

  next(): StreamFrame | null {
    if (this.buf.byteLength < 4) return null
    const len = new DataView(
      this.buf.buffer,
      this.buf.byteOffset,
      this.buf.byteLength,
    ).getUint32(0)
    if (len > 1_048_576) throw new Error(`frame too large: ${len}`)
    if (this.buf.byteLength < 4 + len) return null
    const payload = this.buf.subarray(4, 4 + len)
    this.buf = this.buf.subarray(4 + len)
    return fromBinary(StreamFrameSchema, payload)
  }
}

export function asWritableBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

export async function payloadToBytes(
  data: unknown,
): Promise<Uint8Array | null> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return null
}
