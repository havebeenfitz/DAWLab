/**
 * Reads Apple property lists, binary ("bplist00") or XML. Logic writes its
 * project metadata as binary plists, which the `plist` package can't read.
 * Supports the types Logic uses: null/bool, integers, reals, dates, data,
 * ASCII and UTF-16 strings, UIDs, arrays and dictionaries.
 */
import plist from 'plist'

export type PlistValue = null | boolean | number | string | Date | Buffer | PlistValue[] | { [key: string]: PlistValue }

export function parsePlist(data: Buffer): PlistValue {
  if (data.subarray(0, 8).toString('latin1') === 'bplist00') return parseBinary(data)
  return plist.parse(data.toString('utf8')) as PlistValue
}

function parseBinary(buf: Buffer): PlistValue {
  if (buf.length < 40) throw new Error('Binary plist is too short')
  const trailer = buf.subarray(buf.length - 32)
  const offsetSize = trailer[6]
  const refSize = trailer[7]
  const numObjects = readUInt(trailer, 8, 8)
  const topObject = readUInt(trailer, 16, 8)
  const tableOffset = readUInt(trailer, 24, 8)
  if (!offsetSize || !refSize || tableOffset + numObjects * offsetSize > buf.length - 32) {
    throw new Error('Binary plist has a broken offset table')
  }
  const offsets: number[] = []
  for (let i = 0; i < numObjects; i++) offsets.push(readUInt(buf, tableOffset + i * offsetSize, offsetSize))

  const depthGuard = new Set<number>()
  const readObject = (index: number): PlistValue => {
    if (index >= numObjects) throw new Error('Binary plist refers to a missing object')
    if (depthGuard.has(index)) throw new Error('Binary plist refers to itself')
    depthGuard.add(index)
    try {
      return readAt(offsets[index])
    } finally {
      depthGuard.delete(index)
    }
  }

  /** Reads the length of a container or string: the low nibble, or an int object after it when 0xF. */
  const lengthAt = (pos: number): { length: number; start: number } => {
    const low = buf[pos] & 0x0f
    if (low !== 0x0f) return { length: low, start: pos + 1 }
    const intMarker = buf[pos + 1]
    const bytes = 1 << (intMarker & 0x0f)
    return { length: readUInt(buf, pos + 2, bytes), start: pos + 2 + bytes }
  }

  const readAt = (pos: number): PlistValue => {
    const marker = buf[pos]
    const high = marker >> 4
    switch (high) {
      case 0x0:
        return marker === 0x08 ? false : marker === 0x09 ? true : null
      case 0x1: {
        const bytes = 1 << (marker & 0x0f)
        if (bytes === 8) return Number(buf.readBigInt64BE(pos + 1))
        if (bytes === 16) return Number(buf.readBigInt64BE(pos + 9))
        return readUInt(buf, pos + 1, bytes)
      }
      case 0x2: {
        const bytes = 1 << (marker & 0x0f)
        return bytes === 4 ? buf.readFloatBE(pos + 1) : buf.readDoubleBE(pos + 1)
      }
      case 0x3:
        return new Date((buf.readDoubleBE(pos + 1) + 978307200) * 1000) // seconds since 2001-01-01
      case 0x4: {
        const { length, start } = lengthAt(pos)
        return Buffer.from(buf.subarray(start, start + length))
      }
      case 0x5: {
        const { length, start } = lengthAt(pos)
        return buf.subarray(start, start + length).toString('latin1')
      }
      case 0x6: {
        const { length, start } = lengthAt(pos)
        const utf16be = buf.subarray(start, start + length * 2)
        const swapped = Buffer.from(utf16be)
        swapped.swap16()
        return swapped.toString('utf16le')
      }
      case 0x8:
        return readUInt(buf, pos + 1, (marker & 0x0f) + 1) // UID
      case 0xa: {
        const { length, start } = lengthAt(pos)
        const out: PlistValue[] = []
        for (let i = 0; i < length; i++) out.push(readObject(readUInt(buf, start + i * refSize, refSize)))
        return out
      }
      case 0xd: {
        const { length, start } = lengthAt(pos)
        const out: { [key: string]: PlistValue } = {}
        for (let i = 0; i < length; i++) {
          const key = readObject(readUInt(buf, start + i * refSize, refSize))
          const value = readObject(readUInt(buf, start + (length + i) * refSize, refSize))
          out[String(key)] = value
        }
        return out
      }
      default:
        throw new Error(`Unsupported binary plist object 0x${marker.toString(16)}`)
    }
  }

  return readObject(topObject)
}

function readUInt(buf: Buffer, pos: number, bytes: number): number {
  let value = 0
  for (let i = 0; i < bytes; i++) value = value * 256 + buf[pos + i]
  return value
}
