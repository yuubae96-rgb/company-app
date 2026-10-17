-- Read-only context for the authenticated video storage manager.
-- Only the service role can invoke this function; the Edge Function checks users.
create or replace function public.video_storage_context()
returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select j.id::text as id, 'export'::text as source,
   coalesce(nullif(j.manifest->>'title',''),nullif(j.manifest->'scenes'->0->>'title',''),'動画書き出し') as title,
   (select coalesce(jsonb_agg(jsonb_build_object('title',s->>'title')),'[]'::jsonb) from jsonb_array_elements(coalesce(j.manifest->'scenes','[]'::jsonb)) s) as scenes,
   j.status in ('uploading','queued','running') as active
  from video_export_private.jobs j
  union all
  select j.id::text, 'background'::text,
   coalesce(nullif(j.snapshot->'model'->>'title',''),'画像・音声生成'),
   (select coalesce(jsonb_agg(jsonb_build_object('title',s->>'title')),'[]'::jsonb) from jsonb_array_elements(coalesce(j.snapshot->'model'->'scenes','[]'::jsonb)) s),
   exists(select 1 from public.video_background_items i where i.job_id=j.id and i.status in ('queued','running'))
  from public.video_background_jobs j
 ) x;
$$;
revoke all on function public.video_storage_context() from public,anon,authenticated;
grant execute on function public.video_storage_context() to service_role;
