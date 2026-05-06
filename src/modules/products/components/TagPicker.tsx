import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X } from "lucide-react";

export function TagPicker({ productId }: { productId?: string }) {
  const [tags, setTags] = useState<any[]>([]);
  const [selected, setSelected] = useState<any[]>([]);
  const [newName, setNewName] = useState("");

  const load = async () => {
    const { data: all } = await supabase.from("product_tags").select("*").order("name");
    setTags(all ?? []);
    if (productId) {
      const { data: rels } = await supabase
        .from("product_tag_rel")
        .select("tag_id, product_tags(*)")
        .eq("product_id", productId);
      setSelected((rels ?? []).map((r: any) => r.product_tags));
    }
  };
  useEffect(() => { load(); }, [productId]);

  const toggle = async (tag: any) => {
    if (!productId) return;
    const has = selected.find((t) => t.id === tag.id);
    if (has) {
      await supabase.from("product_tag_rel").delete().eq("product_id", productId).eq("tag_id", tag.id);
      setSelected(selected.filter((t) => t.id !== tag.id));
    } else {
      await supabase.from("product_tag_rel").insert({ product_id: productId, tag_id: tag.id });
      setSelected([...selected, tag]);
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    const color = `hsl(${Math.floor(Math.random() * 360)} 70% 55%)`;
    const { data } = await supabase.from("product_tags").insert({ name: newName.trim(), color }).select().single();
    setNewName("");
    if (data) { setTags([...tags, data]); if (productId) await toggle(data); }
  };

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {selected.map((t) => (
        <Badge key={t.id} style={{ backgroundColor: t.color, color: "#fff" }} className="gap-1">
          {t.name}
          {productId && <button onClick={() => toggle(t)}><X className="h-3 w-3" /></button>}
        </Badge>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 px-2"><Plus className="h-3 w-3" /></Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 space-y-2">
          <div className="flex gap-1">
            <Input className="h-8" placeholder="Nova etiqueta" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button size="sm" onClick={create}>+</Button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-48 overflow-auto">
            {tags.map((t) => {
              const on = selected.find((s) => s.id === t.id);
              return (
                <Badge key={t.id} variant={on ? "default" : "outline"} className="cursor-pointer"
                  style={on ? { backgroundColor: t.color, color: "#fff" } : { borderColor: t.color, color: t.color }}
                  onClick={() => toggle(t)}>{t.name}</Badge>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
