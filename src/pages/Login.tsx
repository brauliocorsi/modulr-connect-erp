import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    const uid = data.user?.id;
    if (uid) {
      const { data: grps } = await supabase
        .from("user_groups")
        .select("groups(code)")
        .eq("user_id", uid);
      const codes = (grps ?? []).map((g: any) => g.groups?.code).filter(Boolean);
      const driverOnly = codes.length > 0 && codes.every((c: string) => c === "delivery_driver");
      nav(driverOnly ? "/delivery" : "/");
      return;
    }
    nav("/");
  };


  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Verifique seu e-mail.");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 text-topbar-foreground bg-topbar relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{ background: "var(--gradient-primary)" }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-2xl font-bold">
            <div className="h-9 w-9 rounded-lg bg-primary grid place-items-center text-primary-foreground">U</div>
            UP Móveis ERP
          </div>
        </div>
        <div className="relative space-y-6 max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            Um ERP modular construído para sua operação.
          </h1>
          <p className="text-lg opacity-90">
            Vendas, Compras e Stock com WMS completo, integrados desde o primeiro dia.
            Adicione novos módulos quando precisar.
          </p>
          <ul className="space-y-2 text-sm opacity-80">
            <li>• Permissões granulares por módulo</li>
            <li>• Reabastecimento automático e regras de stock</li>
            <li>• BOM multinível pronta para manufatura</li>
            <li>• Notificações e chatter em todo registro</li>
          </ul>
        </div>
        <div className="relative text-xs opacity-60">© UP Móveis</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 shadow-elegant">
          <div className="mb-6 lg:hidden flex items-center gap-2 text-xl font-bold">
            <div className="h-8 w-8 rounded-lg bg-primary grid place-items-center text-primary-foreground">U</div>
            UP Móveis ERP
          </div>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="pt-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Senha</Label>
                  <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Entrar
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup" className="pt-6">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome completo</Label>
                  <Input required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Senha</Label>
                  <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Criar conta
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
