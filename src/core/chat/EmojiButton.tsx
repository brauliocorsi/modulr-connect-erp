import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Smile } from "lucide-react";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

export function EmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" title="Inserir emoji">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="p-0 border-none bg-transparent shadow-none w-auto">
        <EmojiPicker
          onEmojiClick={(e) => { onPick(e.emoji); setOpen(false); }}
          width={320}
          height={380}
          emojiStyle={EmojiStyle.NATIVE}
          theme={Theme.AUTO}
          searchPlaceHolder="Buscar emoji…"
          skinTonesDisabled
          previewConfig={{ showPreview: false }}
        />
      </PopoverContent>
    </Popover>
  );
}
