import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Verify caller is admin
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(url, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_group", {
      _user_id: userData.user.id,
      _code: "system_admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden — apenas administradores" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { email, password, full_name, job_title, group_codes } = body as {
      email: string;
      password: string;
      full_name?: string;
      job_title?: string;
      group_codes?: string[];
    };

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "email e password obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? email },
    });
    if (createErr) throw createErr;
    const newUserId = created.user!.id;

    // Update profile extras
    await admin
      .from("profiles")
      .update({ full_name: full_name ?? email, job_title: job_title ?? null })
      .eq("id", newUserId);

    // Replace default groups if explicit list provided
    if (Array.isArray(group_codes)) {
      await admin.from("user_groups").delete().eq("user_id", newUserId);
      if (group_codes.length) {
        const { data: gs } = await admin.from("groups").select("id, code").in("code", group_codes);
        if (gs?.length) {
          await admin
            .from("user_groups")
            .insert(gs.map((g: any) => ({ user_id: newUserId, group_id: g.id })));
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, user_id: newUserId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
