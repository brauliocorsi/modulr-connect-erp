import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type Attachment = { url: string; name: string };

type Props = {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  prefix: string; // e.g. `mo/${moId}`
  max?: number;
};

export function PhotoUploader({ value, onChange, prefix, max = 8 }: Props) {
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const next: Attachment[] = [...value];
      for (const file of Array.from(files)) {
        if (next.length >= max) break;
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("mfg-attachments").upload(path, file, {
          contentType: file.type, upsert: false,
        });
        if (error) { toast.error(error.message); continue; }
        const { data } = supabase.storage.from("mfg-attachments").getPublicUrl(path);
        next.push({ url: data.publicUrl, name: file.name });
      }
      onChange(next);
    } finally { setUploading(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="inline-flex">
          <input
            type="file" accept="image/*" multiple capture="environment"
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <Button type="button" variant="outline" size="sm" asChild>
            <span>
              {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              Adicionar foto
            </span>
          </Button>
        </label>
        <span className="text-xs text-muted-foreground">{value.length}/{max}</span>
      </div>
      {value.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {value.map((a, i) => (
            <div key={i} className="relative group">
              <img src={a.url} alt={a.name} className="w-full h-20 object-cover rounded border" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AttachmentsGrid({ items }: { items: Attachment[] | any }) {
  const list: Attachment[] = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <div className="grid grid-cols-4 gap-1 mt-2">
      {list.map((a, i) => (
        <a key={i} href={a.url} target="_blank" rel="noreferrer">
          <img src={a.url} alt={a.name ?? ""} className="w-full h-16 object-cover rounded border hover:opacity-80" />
        </a>
      ))}
    </div>
  );
}
