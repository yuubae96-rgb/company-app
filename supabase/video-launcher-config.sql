create table if not exists video_export_private.launcher_config(id boolean primary key default true check(id),cipher text not null,updated_at timestamptz not null default now());
alter table video_export_private.launcher_config enable row level security;
grant all on video_export_private.launcher_config to service_role;
create or replace function public.video_export_launcher_config(p_cipher text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_cipher is not null then
  insert into video_export_private.launcher_config(id,cipher) values(true,p_cipher) on conflict(id) do update set cipher=excluded.cipher,updated_at=now();
 end if;
 select jsonb_build_object('cipher',cipher,'updated_at',updated_at) into result from video_export_private.launcher_config where id=true;
 return result;
end $$;
revoke all on function public.video_export_launcher_config(text) from public,anon,authenticated;
grant execute on function public.video_export_launcher_config(text) to service_role;
