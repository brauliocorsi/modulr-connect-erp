import { FileText, FileImage, FileSpreadsheet, FileArchive, File as FileIcon, Download } from "lucide-react";

export type ChatAttachment = {
  url: string;
  name: string;
  size?: number;
  mime?: string;
};

function iconFor(mime?: string, name?: string) {
  const m = (mime || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (m.startsWith("image/")) return FileImage;
  if (m.includes("pdf") || n.endsWith(".pdf")) return FileText;
  if (m.includes("sheet") || /\.(xlsx?|csv)$/.test(n)) return FileSpreadsheet;
  if (m.includes("zip") || /\.(zip|rar|7z)$/.test(n)) return FileArchive;
  if (m.includes("word") || /\.(docx?)$/.test(n)) return FileText;
  return FileIcon;
}

function humanSize(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentBubble({ att }: { att: ChatAttachment }) {
  const isImage = (att.mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
  if (isImage) {
    return (
      <a href={att.url} target="_blank" rel="noreferrer" className="inline-block">
        <img src={att.url} alt={att.name} className="max-h-60 max-w-xs rounded border object-contain" />
      </a>
    );
  }
  const Icon = iconFor(att.mime, att.name);
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-card hover:bg-muted max-w-xs"
    >
      <Icon className="h-5 w-5 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{att.name}</div>
        {att.size ? <div className="text-[10px] text-muted-foreground">{humanSize(att.size)}</div> : null}
      </div>
      <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </a>
  );
}
