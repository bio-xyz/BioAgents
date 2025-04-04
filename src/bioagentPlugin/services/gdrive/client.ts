// https://developers.google.com/workspace/drive/api/reference/rest/v3

import { google, drive_v3 } from "googleapis";
import "dotenv/config";
/**
 * Initialize and return a Google Drive client
 * @param scopes - The OAuth scopes to request
 * @returns The initialized Google Drive client
 */
export async function initDriveClient(
  scopes: string[] = ["https://www.googleapis.com/auth/drive.readonly"]
): Promise<drive_v3.Drive> {
  let credentials: any;
  try {
    // Load credentials
    credentials = JSON.parse(process.env.GCP_JSON_CREDENTIALS || "");
    // Set up authentication
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes,
    });

    // Create and return drive client
    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Error initializing Google Drive client:", error);
    throw error;
  }
}

export const FOLDERS = {
  MAIN_FOLDER: "1Ta7TJ6nq5hTbih-3P_Ck9-BeTgBKpCsg",
};
