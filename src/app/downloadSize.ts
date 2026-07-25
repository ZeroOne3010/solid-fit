export function formatDownloadSize(
  fullSizeBytes: number,
  selectedFiles: number,
  totalFiles: number,
): string {
  const isPartialSelection = selectedFiles < totalFiles;
  const estimatedBytes = isPartialSelection
    ? fullSizeBytes * (selectedFiles / totalFiles)
    : fullSizeBytes;

  return `${isPartialSelection ? "~" : ""}${Math.ceil(estimatedBytes / 1024)} KB`;
}
