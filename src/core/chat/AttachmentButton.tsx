import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ChatAttachment } from "./AttachmentBubble";

type Props = {
  scope: string;
  userId: string | undefined;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  onUploaded: (att: ChatAttachment) => void;
  accept?: string;
};

export function AttachmentButton({ scope, userId, uploading, setUploading, onUploaded, accept }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const onPick = () => ref.current?.click();
  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    if (file.size > 20 * 1024 * 1024) { toast.error("Máximo 20MB"); return; }
    setUploading(true);
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${userId}/${scope}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage
      .from("chat-attachments")
      .upload(path, file, { contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("Erro no upload", { description: error.message });
      return;
    }
    const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    onUploaded({ url: pub.publicUrl, name: file.name, size: file.size, mime: file.type });
    setUploading(false);
  };
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept={accept} onChange={onChange} />
      <Button type="button" variant="ghost" size="icon" onClick={onPick} disabled={uploading} title="Anexar ficheiro">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      </Button>
    </>
  );
}
