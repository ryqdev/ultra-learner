export class ReaderPdfDownloadManager {
  public openOrDownloadData(data: Uint8Array, filename: string, destination: string | null = null): boolean {
    const isPdf = /\.pdf$/i.test(filename);
    const contentType = isPdf ? "application/pdf" : "application/octet-stream";
    const url = URL.createObjectURL(new Blob([copyBuffer(data)], { type: contentType }));
    if (!isPdf) {
      this.triggerDownload(url, filename);
      return false;
    }
    const destinationHash = destination ? `#${encodeURIComponent(destination)}` : "";
    window.open(`${url}${destinationHash}`, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }

  public downloadData(data: Uint8Array, filename: string, contentType = "application/octet-stream"): void {
    const url = URL.createObjectURL(new Blob([copyBuffer(data)], { type: contentType }));
    this.triggerDownload(url, filename);
  }

  public download(data: Uint8Array, url: string, filename: string): void {
    const source = data
      ? URL.createObjectURL(new Blob([copyBuffer(data)], { type: "application/pdf" }))
      : url;
    this.triggerDownload(source, filename);
  }

  private triggerDownload(url: string, filename: string): void {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
    if (url.startsWith("blob:")) window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function copyBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
