import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Paperclip, X, FileText, Image as ImageIcon, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type Attachment = {
  url: string;
  name: string;
  mime?: string | null;
  size?: number | null;
  path?: string;
};

export function AttachmentsField({
  value,
  onChange,
  folder,
  disabled,
  label = "Anexos",
  compact = false,
}: {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  folder: string;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handle = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    const next: Attachment[] = [...value];
    try {
      for (const f of Array.from(files)) {
        const safe = f.name.replace(/[^\w.\-]+/g, "_");
        const path = `${folder}/${Date.now()}_${safe}`;
        const { error } = await supabase.storage
          .from("finance-attachments")
          .upload(path, f, { cacheControl: "3600", upsert: false, contentType: f.type });
        if (error) {
          toast.error(`Falha ao enviar ${f.name}: ${error.message}`);
          continue;
        }
        const { data: pub } = supabase.storage.from("finance-attachments").getPublicUrl(path);
        next.push({ url: pub.publicUrl, name: f.name, mime: f.type, size: f.size, path });
      }
      onChange(next);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (idx: number) => {
    const att = value[idx];
    if (att?.path) {
      await supabase.storage.from("finance-attachments").remove([att.path]);
    }
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className={compact ? "" : "space-y-2"}>
      <div className="flex items-center justify-between">
        {!compact && <div className="text-sm font-medium">{label}</div>}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Paperclip className="h-4 w-4 mr-1" />}
          Anexar
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => handle(e.target.files)}
        />
      </div>
      {value.length === 0 ? (
        <div className="text-xs text-muted-foreground">Sem anexos</div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {value.map((a, i) => {
            const isImg = (a.mime ?? "").startsWith("image/");
            return (
              <li key={i} className="flex items-center gap-2 rounded border bg-card px-2 py-1.5 text-sm">
                {isImg ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 truncate hover:underline" title={a.name}>
                  {a.name}
                </a>
                <a href={a.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Abrir">
                  <Download className="h-4 w-4" />
                </a>
                {!disabled && (
                  <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive" title="Remover">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
