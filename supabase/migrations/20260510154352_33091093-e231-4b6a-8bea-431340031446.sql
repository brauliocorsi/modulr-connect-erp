-- Detach backorder chain on the still-ready receipt
UPDATE public.stock_pickings SET backorder_id = NULL WHERE id = '67d19ffa-7f43-4635-a75d-2ecd477dc076';
-- Remove stale done-with-0 moves and their pickings (no stock was actually moved)
DELETE FROM public.stock_moves WHERE picking_id IN ('59400800-ffa5-4b8a-9b06-1c38d3d2ef92','3b8632bd-06f2-4e7e-8b26-95866fa75c5e');
DELETE FROM public.stock_pickings WHERE id IN ('59400800-ffa5-4b8a-9b06-1c38d3d2ef92','3b8632bd-06f2-4e7e-8b26-95866fa75c5e');