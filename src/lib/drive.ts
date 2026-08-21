import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";

// Lazily initialized so importing this module doesn't throw at build time
// (Next.js evaluates route modules during build, before real env vars exist).
let _drive: drive_v3.Drive | null = null;
let _folderId: string | null = null;

function getDrive(): { drive: drive_v3.Drive; folderId: string } {
  if (!_drive || !_folderId) {
    const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!keyB64 || !folderId) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 and GOOGLE_DRIVE_FOLDER_ID environment variables must be set"
      );
    }

    let credentials: { client_email: string; private_key: string };
    try {
      credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON (expected the full service account key file, base64-encoded)"
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    _drive = google.drive({ version: "v3", auth });
    _folderId = folderId;
  }
  return { drive: _drive, folderId: _folderId };
}

export type DriveUploadResult = { id: string; webViewLink: string };

export async function uploadFile(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<DriveUploadResult> {
  const { drive, folderId } = getDrive();

  // Service accounts have no personal storage quota on a regular "My Drive" folder —
  // even one shared with them as Editor — so the folder must be a Shared Drive, whose
  // storage is billed to the Shared Drive itself. supportsAllDrives is required for the
  // API to operate on Shared Drive content at all.
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const { id, webViewLink } = res.data;
  if (!id || !webViewLink) throw new Error("Drive did not return a file id/link for the upload");

  // Members of the Shared Drive can already see everything in it, but grant the human
  // Workspace owner explicit per-file access too, as a safety net in case they aren't
  // (yet) added as a member of the Shared Drive itself.
  const ownerEmail = process.env.GOOGLE_DRIVE_OWNER_EMAIL;
  if (ownerEmail) {
    await drive.permissions.create({
      fileId: id,
      sendNotificationEmail: false,
      supportsAllDrives: true,
      requestBody: { role: "writer", type: "user", emailAddress: ownerEmail },
    });
  }

  return { id, webViewLink };
}

export async function deleteFile(fileId: string): Promise<void> {
  const { drive } = getDrive();
  // Permanent delete (files.delete) requires the caller to own the file or be an
  // organizer (Manager role) on the Shared Drive — the service account only has
  // Content Manager access. Trashing needs only edit access and is recoverable,
  // which is a reasonable default for a "delete" button anyway.
  await drive.files.update({ fileId, supportsAllDrives: true, requestBody: { trashed: true } });
}
