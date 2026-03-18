import { describe,it,expect } from "vitest"
import { BitWriter } from "../src/compression/bitWriter"
import { BitReader } from "../src/compression/bitReader"
import { writeVLQ,readVLQ,writeSignedVLQ,readSignedVLQ } from "../src/compression/vlq"
import { base64urlEncode,base64urlDecode } from "../src/compression/base64url"

describe("BitWriter/BitReader",()=>{

  it("writes and reads bits correctly",()=>{
    const writer = new BitWriter()
    writer.write(5,5)
    writer.write(10,4)
    
    const bytes = writer.toBytes()
    const reader = new BitReader(bytes)
    
    expect(reader.read(5)).toBe(5)
    expect(reader.read(4)).toBe(10)
  })

  it("handles single bit values",()=>{
    const writer = new BitWriter()
    writer.write(1,1)
    writer.write(0,1)
    writer.write(1,1)
    
    const bytes = writer.toBytes()
    const reader = new BitReader(bytes)
    
    expect(reader.read(1)).toBe(1)
    expect(reader.read(1)).toBe(0)
    expect(reader.read(1)).toBe(1)
  })

  it("handles larger bit sizes",()=>{
    const writer = new BitWriter()
    writer.write(255,8)
    writer.write(0,8)
    writer.write(128,8)
    
    const bytes = writer.toBytes()
    const reader = new BitReader(bytes)
    
    expect(reader.read(8)).toBe(255)
    expect(reader.read(8)).toBe(0)
    expect(reader.read(8)).toBe(128)
  })

})

describe("VLQ",()=>{

  it("encodes and decodes small numbers",()=>{
    const writer = new BitWriter()
    writeVLQ(writer,0)
    writeVLQ(writer,127)
    writeVLQ(writer,128)
    
    const bytes = writer.toBytes()
    const reader = new BitReader(bytes)
    
    expect(readVLQ(reader)).toBe(0)
    expect(readVLQ(reader)).toBe(127)
    expect(readVLQ(reader)).toBe(128)
  })

  it("encodes and decodes larger numbers",()=>{
    const writer = new BitWriter()
    writeVLQ(writer,1000)
    writeVLQ(writer,16384)
    writeVLQ(writer,2097152)
    
    const bytes = writer.toBytes()
    const reader = new BitReader(bytes)
    
    expect(readVLQ(reader)).toBe(1000)
    expect(readVLQ(reader)).toBe(16384)
    expect(readVLQ(reader)).toBe(2097152)
  })

  it("handles signed integers",()=>{
    const writer = new BitWriter()
    writeSignedVLQ(writer,0)
    writeSignedVLQ(writer,-1)
    writeSignedVLQ(writer,1)
    writeSignedVLQ(writer,-128)
    writeSignedVLQ(writer,127)
    
    const bytes = writer.toBytes()
    const reader = new BitReader(bytes)
    
    expect(readSignedVLQ(reader)).toBe(0)
    expect(readSignedVLQ(reader)).toBe(-1)
    expect(readSignedVLQ(reader)).toBe(1)
    expect(readSignedVLQ(reader)).toBe(-128)
    expect(readSignedVLQ(reader)).toBe(127)
  })

})

describe("base64url",()=>{

  it("roundtrips encoded data",()=>{
    const original = new Uint8Array([0,1,2,3,255,128,64,32])
    const encoded = base64urlEncode(original)
    const decoded = base64urlDecode(encoded)
    
    expect(decoded).toEqual(original)
  })

  it("handles empty array",()=>{
    const original = new Uint8Array([])
    const encoded = base64urlEncode(original)
    const decoded = base64urlDecode(encoded)
    
    expect(decoded).toEqual(original)
  })

  it("encodes without padding",()=>{
    const original = new Uint8Array([1,2,3])
    const encoded = base64urlEncode(original)
    
    expect(encoded).not.toMatch(/=/)
  })

  it("handles binary data",()=>{
    const original = Uint8Array.from({length:256},(_,i)=>i)
    const encoded = base64urlEncode(original)
    const decoded = base64urlDecode(encoded)
    
    expect(decoded).toEqual(original)
  })

})
