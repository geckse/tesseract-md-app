/** Binary content accepted by the renderer-facing export API. */
export type BinaryExportContent = ArrayBuffer | Uint8Array

function isArrayBufferValue(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

/**
 * Return an exact Uint8Array for Electron's binary MessagePort channel.
 *
 * Electron 39 serializes an ArrayBuffer whose ownership is transferred from a
 * DOM MessagePort to MessagePortMain as `null`. A Uint8Array sent without a
 * transfer list survives that boundary. Full ArrayBuffer-backed values stay
 * allocation-free; sliced or SharedArrayBuffer-backed views are copied into a
 * tight buffer so bytes outside the requested view never cross the process
 * boundary.
 */
export function toMessagePortBinaryPayload(content: BinaryExportContent): Uint8Array {
  if (isArrayBufferValue(content)) return new Uint8Array(content)

  if (!ArrayBuffer.isView(content)) {
    throw new TypeError('Invalid binary export content')
  }

  const backing = content.buffer
  if (
    isArrayBufferValue(backing) &&
    content.byteOffset === 0 &&
    content.byteLength === backing.byteLength
  ) {
    return new Uint8Array(backing)
  }

  const exact = new Uint8Array(content.byteLength)
  exact.set(new Uint8Array(backing, content.byteOffset, content.byteLength))
  return exact
}
