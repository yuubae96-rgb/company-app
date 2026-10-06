create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists video_jobs_private;
revoke all on schema video_jobs_private from public, anon, authenticated;
create table video_jobs_private.config (id boolean primary key default true check(id), worker_token text not null);
insert into video_jobs_private.config(worker_token) values (encode(extensions.gen_random_bytes(32),'hex'));
alter table video_jobs_private.config enable row level security;
create table public.video_background_jobs (
 id uuid primary key, owner_hash text not null, snapshot jsonb not null,
 created_at timestamptz not null default now(), cancelled boolean not null default false
);
create table public.video_background_items (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.video_background_jobs(id) on delete cascade,
 ordinal integer not null, scene_index integer not null, kind text not null check(kind in ('image','audio')),
 request jsonb not null, status text not null default 'queued' check(status in ('queued','running','done','failed','cancelled')),
 started_at timestamptz, finished_at timestamptz, lease uuid, result jsonb, error text,
 unique(job_id,ordinal)
);
create index video_background_pending_idx on public.video_background_items(status,job_id,ordinal);
create index video_background_owner_idx on public.video_background_jobs(owner_hash,created_at);
alter table public.video_background_jobs enable row level security;
alter table public.video_background_items enable row level security;
revoke all on public.video_background_jobs,public.video_background_items from public,anon,authenticated;
grant all on public.video_background_jobs,public.video_background_items to service_role;

create function public.video_jobs_worker_token() returns text language sql security invoker set search_path='' as $$ select worker_token from video_jobs_private.config where id $$;
grant usage on schema video_jobs_private to service_role;
grant select on video_jobs_private.config to service_role;
create function public.video_jobs_enqueue(p_id uuid,p_owner text,p_snapshot jsonb,p_items jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare old_owner text; x jsonb; n int:=0;
begin
 perform pg_advisory_xact_lock(hashtext('video_jobs_enqueue'));
 select owner_hash into old_owner from public.video_background_jobs where id=p_id;
 if found then if old_owner<>p_owner then raise exception 'Forbidden'; end if; return p_id; end if;
 if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>120 then raise exception '仕事の件数が不正です'; end if;
 if (select count(*) from public.video_background_items i join public.video_background_jobs j on j.id=i.job_id where j.owner_hash=p_owner and i.status in ('queued','running'))>0 then raise exception 'すでに作成中です。現在の処理を確認してください'; end if;
 if (select count(*) from public.video_background_items i join public.video_background_jobs j on j.id=i.job_id where j.created_at>now()-interval '1 day') + jsonb_array_length(p_items)>500 then raise exception '本日の生成上限です。明日再試行してください'; end if;
 insert into public.video_background_jobs(id,owner_hash,snapshot) values(p_id,p_owner,p_snapshot);
 for x in select value from jsonb_array_elements(p_items) loop
  insert into public.video_background_items(job_id,ordinal,scene_index,kind,request) values(p_id,n,(x->>'sceneIndex')::integer,x->>'kind',x->'request'); n:=n+1;
 end loop; return p_id;
end $$;
create function public.video_jobs_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.video_background_items; ticket uuid;
begin
 perform pg_advisory_xact_lock(hashtext('video_jobs_claim'));
 update public.video_background_items set status='failed',error='処理が時間切れになりました。失敗した場面だけ再試行してください。',finished_at=now() where status='running' and started_at<now()-interval '5 minutes';
 if (select count(*) from public.video_background_items where status='running')>=2 then return null; end if;
 select i.* into item from public.video_background_items i join public.video_background_jobs j on j.id=i.job_id
 where i.status='queued' and not j.cancelled and not exists(select 1 from public.video_background_items r where r.job_id=i.job_id and r.status='running')
 order by j.created_at,i.ordinal limit 1 for update of i skip locked;
 if not found then return null; end if;
 ticket:=gen_random_uuid(); update public.video_background_items set status='running',started_at=now(),lease=ticket where id=item.id;
 return to_jsonb(item)||jsonb_build_object('lease',ticket);
end $$;
create function public.video_jobs_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.video_background_items set status=case when p_error is null then 'done' else 'failed' end,result=p_result,error=p_error,finished_at=now()
 where id=p_id and lease=p_lease and status='running'; return found;
end $$;
revoke all on function public.video_jobs_worker_token(),public.video_jobs_enqueue(uuid,text,jsonb,jsonb),public.video_jobs_claim(),public.video_jobs_finish(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.video_jobs_worker_token(),public.video_jobs_enqueue(uuid,text,jsonb,jsonb),public.video_jobs_claim(),public.video_jobs_finish(uuid,uuid,jsonb,text) to service_role;

create function video_jobs_private.dispatch() returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.video_background_items set status='failed',error='処理が時間切れになりました。失敗した場面だけ再試行してください。',finished_at=now() where status='running' and started_at<now()-interval '5 minutes';
 if exists(select 1 from public.video_background_items i join public.video_background_jobs j on j.id=i.job_id where i.status='queued' and not j.cancelled) then
 perform net.http_post(url:='https://vnnvuxccazkdzwqjmntz.supabase.co/functions/v1/video-background-jobs',headers:=jsonb_build_object('Content-Type','application/json','x-video-worker-token',(select worker_token from video_jobs_private.config where id)),body:='{"action":"work"}'::jsonb,timeout_milliseconds:=10000);
 end if;
end $$;
revoke all on function video_jobs_private.dispatch() from public,anon,authenticated;
select cron.schedule('video-background-dispatch','* * * * *','select video_jobs_private.dispatch()');
select cron.schedule('video-background-cleanup','15 19 * * *','delete from public.video_background_jobs where created_at < now()-interval ''30 days''');
