"""
Google Drive API Helper Module (Mode B).
Handles secure read-only connection to Google Drive API.
Supports folders shared with the user ('Shared with me') and shared drives.
Captures Google Drive file webViewLink and full metadata.
Reports explicit diagnostic API errors for permission denied or missing folders.
Supports media download for local OCR document inspection.
"""

import os
import sys
import io
import logging
from typing import List, Dict, Any, Optional

# Clean invalid system CA bundle env vars pointing to missing files
for _env in ["SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"]:
    _val = os.environ.get(_env)
    if _val and not os.path.exists(_val):
        os.environ.pop(_env, None)

logger = logging.getLogger("gdrive_helper")
logging.basicConfig(level=logging.INFO)

HAS_GDRIVE_LIBS = False
try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    from googleapiclient.errors import HttpError
    HAS_GDRIVE_LIBS = True
except ImportError:
    HAS_GDRIVE_LIBS = False

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']


class GDriveHelper:
    """Helper class for scanning Google Drive participant folders via API."""
    
    def __init__(self, credentials_path: Optional[str] = None):
        self.credentials_path = credentials_path or os.environ.get("GDRIVE_CREDENTIALS_PATH", "credentials.json")
        self.service = None
        self.last_error: Optional[str] = None

    def authenticate(self) -> bool:
        """Authenticate with Google Drive API using OAuth Client credentials or Service Account."""
        if not HAS_GDRIVE_LIBS:
            self.last_error = "google-api-python-client or google-auth package not installed."
            logger.error(self.last_error)
            return False

        if not os.path.exists(self.credentials_path):
            self.last_error = f"Google credentials file not found at: {self.credentials_path}"
            logger.error(self.last_error)
            return False

        try:
            token_path = "token.json"
            creds = None
            if os.path.exists(token_path):
                try:
                    creds = Credentials.from_authorized_user_file(token_path, SCOPES)
                except Exception as e:
                    logger.debug(f"Failed loading token.json: {e}")

            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                else:
                    if "service_account" in self.credentials_path:
                        creds = service_account.Credentials.from_service_account_file(
                            self.credentials_path, scopes=SCOPES
                        )
                    else:
                        flow = InstalledAppFlow.from_client_secrets_file(self.credentials_path, SCOPES)
                        creds = flow.run_local_server(port=0)
                
                if hasattr(creds, 'to_json'):
                    with open(token_path, 'w') as token_file:
                        token_file.write(creds.to_json())

            self.service = build('drive', 'v3', credentials=creds)
            logger.info("Successfully authenticated with Google Drive API.")
            return True
        except Exception as err:
            self.last_error = f"Google Drive API authentication error: {err}"
            logger.error(self.last_error)
            return False

    def get_folder_metadata(self, folder_id: str) -> Dict[str, Any]:
        """Fetch metadata for a given Google Drive folder ID."""
        if not self.service:
            if not self.authenticate():
                raise RuntimeError(self.last_error or "Google Drive API service is not authenticated.")

        try:
            res = self.service.files().get(
                fileId=folder_id,
                fields="id, name, mimeType, webViewLink, owners, createdTime, modifiedTime",
                supportsAllDrives=True
            ).execute()
            return res
        except HttpError as he:
            err_msg = f"HTTP {he.resp.status} Error accessing folder '{folder_id}': {he._get_reason()}"
            self.last_error = err_msg
            raise RuntimeError(err_msg)
        except Exception as e:
            err_msg = f"Failed to fetch metadata for Google Drive folder ID '{folder_id}': {e}"
            self.last_error = err_msg
            raise RuntimeError(err_msg)

    def list_participant_folders(self, root_folder_id: str) -> List[Dict[str, Any]]:
        """List immediate child folders in the master Google Drive folder."""
        if not self.service:
            if not self.authenticate():
                raise RuntimeError(self.last_error or "Google Drive API service is not authenticated.")

        query = f"'{root_folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = []
        page_token = None

        try:
            while True:
                response = self.service.files().list(
                    q=query,
                    spaces='drive',
                    fields='nextPageToken, files(id, name, webViewLink, createdTime, modifiedTime)',
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageToken=page_token
                ).execute()

                for folder in response.get('files', []):
                    web_link = folder.get('webViewLink') or f"https://drive.google.com/drive/folders/{folder.get('id')}"
                    results.append({
                        "id": folder.get('id'),
                        "name": folder.get('name'),
                        "webViewLink": web_link,
                        "createdTime": folder.get('createdTime'),
                        "modifiedTime": folder.get('modifiedTime')
                    })

                page_token = response.get('nextPageToken', None)
                if not page_token:
                    break
        except HttpError as he:
            err_msg = f"HTTP {he.resp.status} Access Error: {he._get_reason()} (Folder: {root_folder_id})"
            self.last_error = err_msg
            raise RuntimeError(err_msg)
        except Exception as e:
            err_msg = f"Error listing child folders in master folder '{root_folder_id}': {e}"
            self.last_error = err_msg
            raise RuntimeError(err_msg)

        results.sort(key=lambda x: x["name"].lower())
        return results

    def list_folder_files_recursive(self, folder_id: str) -> List[Dict[str, Any]]:
        """Recursively list all files inside an enterprise folder tree."""
        if not self.service:
            return []

        all_files = []
        folders_to_process = [folder_id]

        try:
            while folders_to_process:
                current_fid = folders_to_process.pop(0)

                file_query = f"'{current_fid}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false"
                page_token = None
                while True:
                    response = self.service.files().list(
                        q=file_query,
                        spaces='drive',
                        fields='nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime, modifiedTime)',
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True,
                        pageToken=page_token
                    ).execute()

                    for file in response.get('files', []):
                        fid = file.get('id')
                        web_link = file.get('webViewLink') or f"https://drive.google.com/file/d/{fid}/view"
                        all_files.append({
                            "fileId": fid,
                            "name": file.get('name'),
                            "mimeType": file.get('mimeType'),
                            "size": int(file.get('size', 0)),
                            "webViewLink": web_link,
                            "createdTime": file.get('createdTime'),
                            "modifiedTime": file.get('modifiedTime')
                        })

                    page_token = response.get('nextPageToken', None)
                    if not page_token:
                        break

                folder_query = f"'{current_fid}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                page_token = None
                while True:
                    response = self.service.files().list(
                        q=folder_query,
                        spaces='drive',
                        fields='nextPageToken, files(id, name)',
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True,
                        pageToken=page_token
                    ).execute()

                    for subf in response.get('files', []):
                        folders_to_process.append(subf.get('id'))

                    page_token = response.get('nextPageToken', None)
                    if not page_token:
                        break
        except Exception as e:
            logger.warning(f"Error reading subfolder tree for folder {folder_id}: {e}")

        return all_files

    def download_file_content(self, file_id: str, dest_path: str) -> bool:
        """Download file media content from Google Drive to a local temporary path."""
        if not self.service:
            if not self.authenticate():
                return False

        try:
            request = self.service.files().get_media(fileId=file_id, supportsAllDrives=True)
            with io.FileIO(dest_path, 'wb') as fh:
                downloader = MediaIoBaseDownload(fh, request)
                done = False
                while not done:
                    status, done = downloader.next_chunk()
            return True
        except Exception as e:
            logger.warning(f"Failed downloading content for Google Drive file ID '{file_id}': {e}")
            return False
