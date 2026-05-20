import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerCreditsPanel } from "@/modules/finance/components/CustomerCreditsPanel";

export default function CustomerCreditsPage() {
  const [partnerId, setPartnerId] = useState<string>("");

  const partners = useQuery({
    queryKey: ["partners-customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("partners")
        .select("id,name")
        .eq("is_customer", true)
        .order("name")
        .limit(500);
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader
        title="Créditos de Cliente"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Créditos" }]}
      />
      <PageBody>
        <Card className="p-4 mb-4">
          <Label>Cliente</Label>
          <Select value={partnerId} onValueChange={setPartnerId}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="Selecione um cliente…" /></SelectTrigger>
            <SelectContent>
              {(partners.data ?? []).map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>
        {partnerId ? (
          <CustomerCreditsPanel partnerId={partnerId} />
        ) : (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Selecione um cliente para ver e gerir os seus créditos.
          </Card>
        )}
      </PageBody>
    </>
  );
}
