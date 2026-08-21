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

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, webViewLink",
  });

  const { id, webViewLink } = res.data;
  if (!id || !webViewLink) throw new Error("Drive did not return a file id/link for the upload");

  // Files created by the service account live in its own Drive space and are only
  // visible to the service account itself, even inside a folder shared *with* it —
  // sharing a folder grants write access, not automatic visibility of files created there.
  // Explicitly grant the human Workspace owner access so "Open file" actually works for them.
  const ownerEmail = process.env.GOOGLE_DRIVE_OWNER_EMAIL;
  if (ownerEmail) {
    await drive.permissions.create({
      fileId: id,
      sendNotificationEmail: false,
      requestBody: { role: "writer", type: "user", emailAddress: ownerEmail },
    });
  }

  return { id, webViewLink };
}

export async function deleteFile(fileId: string): Promise<void> {
  const { drive } = getDrive();
  await drive.files.delete({ fileId });
}
