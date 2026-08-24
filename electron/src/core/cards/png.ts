const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const decoder = new TextDecoder();

/**
 * 只走路过 PNG 的 tEXt。酒馆卡把 V2 JSON（base64）放在 `chara`，
 * V3 放在 `ccv3`。不解码像素，也不跟 iTXt / zTXt。
 */
export function readPngText(bytes: Uint8Array): Map<string, string> {
  for (let i = 0; i < PNG_SIG.length; i += 1) {
    if (bytes[i] !== PNG_SIG[i]) {
      throw new Error("不是 PNG");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) break;
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IEND") break;
    if (type === "tEXt") {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const key = decoder.decode(data.subarray(0, zero));
        const value = decoder.decode(data.subarray(zero + 1));
        out.set(key, value);
      }
    }
    offset += 12 + length;
  }
  return out;
}

export function decodeCharaPayload(encoded: string): unknown {
  const binary = atob(encoded.trim());
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
