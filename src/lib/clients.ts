import { sql } from "./db";
import { createFolder } from "./drive";

// Folder creation is deferred to the first upload so creating a client never depends on
// Drive being reachable, and clients that predate this feature get a folder on demand.
export async function getClientFolderId(clientId: string): Promise<string | null> {
  const rows = await sql`select name, drive_folder_id from clients where id = ${clientId}`;
  const client = rows[0];
  if (!client) return null;
  if (client.drive_folder_id) return client.drive_folder_id as string;

  const folderId = await createFolder(client.name as string);
  await sql`update clients set drive_folder_id = ${folderId} where id = ${clientId}`;
  return folderId;
}
