export interface ElectronBackupFile {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: string;
  kind: 'auto' | 'manual';
}

export interface ElectronAPI {
  isElectron: boolean;
  saveBackup: (
    jsonContent: string,
    kind?: 'auto' | 'manual',
    customDir?: string
  ) => Promise<{
    ok: boolean;
    filePath?: string;
    fileName?: string;
    directory?: string;
    error?: string;
  }>;
  listBackups: (customDir?: string) => Promise<{
    ok: boolean;
    directory?: string;
    backups?: ElectronBackupFile[];
    error?: string;
  }>;
  restoreBackup: (filePath?: string) => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    jsonContent?: string;
    error?: string;
  }>;
  printToPDF: (options?: {
    defaultFileName?: string;
    companyName?: string;
    landscape?: boolean;
  }) => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    error?: string;
  }>;
  selectFolder: (currentDir?: string) => Promise<{
    ok: boolean;
    canceled?: boolean;
    directory?: string;
  }>;
  getDefaultBackupFolder: () => Promise<{
    ok: boolean;
    directory?: string;
  }>;
  onRequestCloseBackup: (callback: () => void) => () => void;
  notifyCloseBackupDone: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
