-- Binary media lives in private Storage. Postgres holds bounded metadata only.
insert into storage.buckets(id,name,public,file_size_limit)
values ('video-background-media','video-background-media',false,20971520)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;

-- Existing project policies broadly allow signed-in users to read other buckets.
-- This additional restrictive policy keeps this bucket behind the job-owner API.
create policy video_background_media_private on storage.objects as restrictive
for all to anon,authenticated
using (bucket_id <> 'video-background-media')
with check (bucket_id <> 'video-background-media');

create or replace function public.video_jobs_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_error is null and (p_result is null or p_result ? 'data' or not (p_result ? 'media') or octet_length(p_result::text)>262144) then
  raise exception 'Generated media must be stored in private Storage';
 end if;
 update public.video_background_items
 set status=case when p_error is null then 'done' else 'failed' end,
 result=p_result,error=p_error,finished_at=now()
 where id=p_id and lease=p_lease and status='running';
 return found;
end $$;

create or replace function public.video_jobs_archive_result(p_id uuid,p_result jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_result is null or p_result ? 'data' or not (p_result ? 'media') or octet_length(p_result::text)>262144 then
  raise exception 'Invalid media reference';
 end if;
 update public.video_background_items set result=p_result
 where id=p_id and status='done' and result ? 'data';
 return found;
end $$;

create or replace function public.video_jobs_expired_media()
returns table(name text) language sql security invoker set search_path='' as $$
 select o.name from storage.objects o
 where o.bucket_id='video-background-media' and o.created_at < now()-interval '30 days'
 order by o.created_at limit 200;
$$;

create or replace function public.video_jobs_prune_metadata()
returns bigint language plpgsql security invoker set search_path='' as $$
declare deleted bigint;
begin
 delete from public.video_background_jobs j where j.id in (
  select old.id from public.video_background_jobs old
  where old.created_at < now()-interval '30 days'
  and not exists(select 1 from public.video_background_items i where i.job_id=old.id and i.status in ('queued','running'))
  and not exists(select 1 from storage.objects o where o.bucket_id='video-background-media' and o.name like old.id::text||'/%')
  order by old.created_at limit 200
 );
 get diagnostics deleted = row_count; return deleted;
end $$;

create or replace function video_jobs_private.cleanup_dispatch()
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform net.http_post(
  url:='https://vnnvuxccazkdzwqjmntz.supabase.co/functions/v1/video-background-jobs',
  headers:=jsonb_build_object('Content-Type','application/json','x-video-worker-token',(select worker_token from video_jobs_private.config where id)),
  body:='{"action":"cleanup"}'::jsonb,timeout_milliseconds:=10000
 );
end $$;

revoke all on function public.video_jobs_archive_result(uuid,jsonb),public.video_jobs_expired_media(),public.video_jobs_prune_metadata(),video_jobs_private.cleanup_dispatch() from public,anon,authenticated;
grant execute on function public.video_jobs_archive_result(uuid,jsonb),public.video_jobs_expired_media(),public.video_jobs_prune_metadata(),video_jobs_private.cleanup_dispatch() to service_role;
revoke all on function public.video_jobs_finish(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.video_jobs_finish(uuid,uuid,jsonb,text) to service_role;
select cron.schedule('video-background-cleanup','17 * * * *','select video_jobs_private.cleanup_dispatch()');
