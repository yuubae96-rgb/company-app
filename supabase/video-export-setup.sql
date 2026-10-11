create schema if not exists video_export_private;
revoke all on schema video_export_private from public,anon,authenticated;
grant usage on schema video_export_private to service_role;
create table if not exists video_export_private.jobs (
 id uuid primary key, user_id uuid not null, status text not null default 'uploading',
 manifest jsonb not null, assets jsonb not null, lease uuid, progress int not null default 0,
 error text, output_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table video_export_private.jobs enable row level security;
grant all on video_export_private.jobs to service_role;
create or replace function public.video_export_job(p_action text,p_id uuid default null,p_user uuid default null,p_manifest jsonb default null,p_assets jsonb default null,p_lease uuid default null,p_progress int default 0,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j video_export_private.jobs;
begin
 if p_action='create' then
  if (select count(*) from video_export_private.jobs where user_id=p_user and status in ('uploading','queued','running') and created_at>now()-interval '2 hours')>=3 then raise exception '同時に書き出せる動画は3件までです';end if;
  insert into video_export_private.jobs(id,user_id,manifest,assets) values(p_id,p_user,p_manifest,p_assets) returning * into j;
 elsif p_action='claim' then
  select * into j from video_export_private.jobs where status='queued' or (status='running' and updated_at<now()-interval '10 minutes') order by created_at for update skip locked limit 1;
  if j.id is null then return null;end if;
  update video_export_private.jobs set status='running',lease=gen_random_uuid(),updated_at=now(),error=null where id=j.id returning * into j;
 elsif p_action in ('progress','done','failed') then
  update video_export_private.jobs set status=case p_action when 'done' then 'done' when 'failed' then 'failed' else status end,progress=least(100,greatest(0,p_progress)),error=p_error,output_path=case when p_action='done' then id::text||'/video.mp4' else output_path end,updated_at=now() where id=p_id and lease=p_lease and status='running' returning * into j;
  if j.id is null then raise exception '書き出しの処理期限が切れました';end if;
 else
  select * into j from video_export_private.jobs where id=p_id and user_id=p_user;
  if j.id is null then return null;end if;
  if p_action='queue' and j.status='uploading' then update video_export_private.jobs set status='queued',updated_at=now() where id=p_id returning * into j;
  elsif p_action='cancel' then update video_export_private.jobs set status='cancelled',updated_at=now() where id=p_id returning * into j;
  end if;
 end if;
 return to_jsonb(j);
end $$;
revoke all on function public.video_export_job(text,uuid,uuid,jsonb,jsonb,uuid,int,text) from public,anon,authenticated;
grant execute on function public.video_export_job(text,uuid,uuid,jsonb,jsonb,uuid,int,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('video-exports','video-exports',false,524288000) on conflict(id) do nothing;
