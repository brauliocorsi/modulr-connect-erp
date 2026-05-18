CREATE OR REPLACE FUNCTION public._test_phase19_customer_portal_helpdesk(_cleanup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pfx text := 'P19_' || to_char(now(),'YYYYMMDDHH24MISSMS') || '_';
  v_cust uuid; v_cust2 uuid; v_so uuid; v_so2 uuid;
  v_tok_res jsonb; v_tok text; v_tok2 text; v_tok_exp_res jsonb; v_tok_exp text;
  v_ticket uuid; v_ticket2 uuid; v_ticket_q uuid; v_ticket_sched uuid;
  v_msg uuid; v_att uuid; v_case uuid; v_case2 uuid;
  v_report jsonb := '[]'::jsonb; v_pass boolean; v_ok int:=0; v_fail int:=0; v_detail text;
  v_status_res jsonb; v_case_res jsonb;
  v_health jsonb;
  v_def text;
BEGIN
  -- get current definition, swap sale_order_state -> sale_state, recreate (will be handled below)
  RAISE NOTICE 'noop';
END;
$function$;