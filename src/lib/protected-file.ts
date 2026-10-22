// Word and Excel files saved with a password are stored in an encrypted container instead
// of the usual zip, so the portal cannot read them. Catch that at upload with a clear message
// instead of storing a file nobody can use.
export const PROTECTED_FILE_MESSAGE =
  "This file is password-protected, so the portal cannot read it. Please remove the password and upload it again.";

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function isEncryptedOffice(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  if (!OLE_SIGNATURE.every((b, i) => buffer[i] === b)) return false;
  // The encryption stream is named "EncryptionInfo" (stored as UTF-16 in the container).
  return buffer.includes(Buffer.from("EncryptionInfo", "utf16le")) || buffer.includes(Buffer.from("EncryptionInfo"));
}

// An encrypted PDF carries an /Encrypt entry. Some only restrict printing and still open
// fine, so this is only used to explain a failed read, never to reject an upload.
export function looksEncryptedPdf(buffer: Buffer): boolean {
  return buffer.includes(Buffer.from("/Encrypt"));
}
