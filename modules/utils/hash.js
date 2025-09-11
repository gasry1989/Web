/**
 * 计算字符串的 SHA-256 十六进制摘要
 * 使用 Web Crypto API
 */
export async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest);
  // 转十六进制
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}