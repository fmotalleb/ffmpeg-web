export interface BrowseEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface BrowseResponse {
  path: string;
  parent: string;
  entries: BrowseEntry[];
}

export interface ScanResponse {
  path: string;
  count: number;
  totalSize: number;
  files: { path: string; rel: string; size: number }[];
}

export interface PreviewCommand {
  bin: string;
  args: string[];
}
