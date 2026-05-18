-- F18-C bootstrap aditivo: localizações faltantes no armazém WH (00000000-0000-0000-0000-000000000010).
-- _svc_repair_loc filtra por warehouse_id=WH e name; REPAIR, OUTLET e Stock já existem.
-- Faltam: QUARANTINE, DAMAGED, SCRAP. Migração estritamente aditiva, idempotente.

INSERT INTO public.stock_locations (warehouse_id, name, full_path, type, is_zone, active, return_kind)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, 'QUARANTINE', 'WH/QUARANTINE',
       'internal'::location_type, true, true, 'quarantine'::return_kind
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_locations
  WHERE warehouse_id='00000000-0000-0000-0000-000000000010' AND name='QUARANTINE'
);

INSERT INTO public.stock_locations (warehouse_id, name, full_path, type, is_zone, active, return_kind)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, 'DAMAGED', 'WH/DAMAGED',
       'internal'::location_type, true, true, 'damaged'::return_kind
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_locations
  WHERE warehouse_id='00000000-0000-0000-0000-000000000010' AND name='DAMAGED'
);

-- SCRAP: usa tipo inventory_loss (mesmo padrão de Virtual/Scrap existente) — claramente não vendável.
INSERT INTO public.stock_locations (warehouse_id, name, full_path, type, is_zone, active, return_kind)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, 'SCRAP', 'WH/SCRAP',
       'inventory_loss'::location_type, true, true, 'damaged'::return_kind
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_locations
  WHERE warehouse_id='00000000-0000-0000-0000-000000000010' AND name='SCRAP'
);