CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.app_config (key text PRIMARY KEY, value text NOT NULL);
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_api(p_secret text, p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_id uuid; r record;
BEGIN
  IF p_secret IS NULL OR NOT EXISTS (SELECT 1 FROM private.app_config WHERE key = 'orders_api_secret' AND value = p_secret) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_action = 'create' THEN
    INSERT INTO public.orders (customer_name, customer_email, customer_cpf, customer_phone, app_email, selected_number, chip_type, plan, amount, utms)
    VALUES (p_payload->>'customer_name', p_payload->>'customer_email', p_payload->>'customer_cpf', p_payload->>'customer_phone', p_payload->>'app_email', p_payload->>'selected_number', p_payload->>'chip_type', p_payload->>'plan', (p_payload->>'amount')::numeric, p_payload->'utms')
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  ELSIF p_action = 'set_pix' THEN
    UPDATE public.orders SET pix_code = p_payload->>'pix_code', qr_code_url = p_payload->>'qr_code_url', gateway_transaction_id = p_payload->>'gateway_transaction_id' WHERE id = (p_payload->>'id')::uuid;
    RETURN '{}'::jsonb;
  ELSIF p_action = 'fail' THEN
    UPDATE public.orders SET status = 'failed' WHERE id = (p_payload->>'id')::uuid;
    RETURN '{}'::jsonb;
  ELSIF p_action = 'set_status_by_tx' THEN
    UPDATE public.orders SET status = p_payload->>'status' WHERE gateway_transaction_id = p_payload->>'tx' AND status = 'pending';
    RETURN '{}'::jsonb;
  ELSIF p_action = 'get' THEN
    SELECT status, gateway_transaction_id INTO r FROM public.orders WHERE id = (p_payload->>'id')::uuid;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('status', r.status, 'gateway_transaction_id', r.gateway_transaction_id);
  END IF;
  RAISE EXCEPTION 'unknown action';
END $$;
REVOKE ALL ON FUNCTION public.orders_api(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orders_api(text, text, jsonb) TO anon, authenticated, service_role;