-- 020_function_search_path.sql
--
-- Pin search_path on the migration-019 helpers (Supabase WARN
-- function_search_path_mutable). A mutable search_path lets a schema
-- planted earlier in the path shadow builtins inside SECURITY DEFINER
-- functions; these are invoker-rights and all object references are
-- already schema-qualified (public.settings) or pg_catalog builtins, so
-- pinning the path changes behavior in no case except an active attack.
-- No logic changes vs 019. Safe to apply live: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION append_setting_list_item(
  p_key text,
  p_list text,
  p_item jsonb,
  p_max integer,
  p_prepend boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
BEGIN
  -- Single statement: the row lock serializes concurrent writers, so no
  -- read-modify-write race is possible. Missing row is created inline.
  INSERT INTO public.settings(key, value)
  VALUES (p_key, jsonb_build_object(p_list, jsonb_build_array(p_item)))
  ON CONFLICT(key) DO UPDATE SET value = jsonb_build_object(
    p_list,
    (
      SELECT COALESCE(jsonb_agg(x ORDER BY o), '[]'::jsonb)
      FROM (
        SELECT * FROM jsonb_array_elements(
          CASE
            WHEN p_prepend THEN p_item || (
              CASE WHEN jsonb_typeof(COALESCE(settings.value->p_list, '[]'::jsonb)) = 'array'
                THEN COALESCE(settings.value->p_list, '[]'::jsonb)
                ELSE '[]'::jsonb END
            )
            ELSE (
              CASE WHEN jsonb_typeof(COALESCE(settings.value->p_list, '[]'::jsonb)) = 'array'
                THEN COALESCE(settings.value->p_list, '[]'::jsonb)
                ELSE '[]'::jsonb END
            ) || p_item
          END
        ) WITH ORDINALITY AS t(x, o)
        -- Newest p_max survive: head for prepend lists (ORDER BY o ASC),
        -- tail for append lists (ORDER BY o DESC, re-sorted below).
        ORDER BY (CASE WHEN p_prepend THEN o END) ASC,
                 (CASE WHEN NOT p_prepend THEN o END) DESC
        LIMIT GREATEST(COALESCE(p_max, 100), 1)
      ) s
    )
  );
END $$;

CREATE OR REPLACE FUNCTION claim_agent_triggers(p_agent text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  cur jsonb;
  arr jsonb;
  ords integer[] := '{}';
  r record;
  lim integer := GREATEST(COALESCE(p_limit, 10), 1);
  rebuilt jsonb;
  claimed jsonb;
BEGIN
  SELECT value INTO cur FROM public.settings WHERE key = 'pending_agent_events' FOR UPDATE;
  IF cur IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  arr := cur->'triggers';
  IF jsonb_typeof(arr) IS DISTINCT FROM 'array' THEN
    RETURN '[]'::jsonb;
  END IF;
  FOR r IN
    SELECT t.x AS item, t.o AS o
    FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(x, o)
    ORDER BY t.o
  LOOP
    -- typeof guard: a hand-edited junk row must never abort the claim loop.
    IF jsonb_typeof(r.item) = 'object'
       AND (r.item->>'agent_id') = p_agent
       AND COALESCE((r.item->>'consumed')::boolean, false) = false THEN
      ords := ords || r.o;
    END IF;
  END LOOP;
  IF coalesce(array_length(ords, 1), 0) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF array_length(ords, 1) > lim THEN
    ords := ords[array_length(ords, 1) - lim + 1 : array_length(ords, 1)];
  END IF;
  SELECT COALESCE(jsonb_agg(
    CASE WHEN t.o = ANY(ords) THEN t.x || '{"consumed": true}'::jsonb ELSE t.x END
    ORDER BY t.o
  ), '[]'::jsonb)
  INTO rebuilt
  FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(x, o);
  -- Same 100-cap the JS applied (.slice(-100)).
  SELECT COALESCE(jsonb_agg(x ORDER BY o), '[]'::jsonb) INTO rebuilt
  FROM (
    SELECT * FROM jsonb_array_elements(rebuilt) WITH ORDINALITY AS t2(x, o)
    ORDER BY o DESC LIMIT 100
  ) s;
  UPDATE public.settings
  SET value = jsonb_set(cur, '{triggers}', rebuilt)
  WHERE key = 'pending_agent_events';
  SELECT COALESCE(jsonb_agg(t.x ORDER BY t.o), '[]'::jsonb) INTO claimed
  FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(x, o)
  WHERE t.o = ANY(ords);
  RETURN claimed;
END $$;
