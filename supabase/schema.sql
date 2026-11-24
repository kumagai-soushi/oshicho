-- =========================================================
-- 推し帳 schema.sql
-- Supabase の SQL Editor に丸ごと貼って実行する。
-- 何度実行しても壊れないように書いてある（データは消えない）。
--
-- 守り方：
--   * テーブルは RLS 有効・ポリシーなし ＋ anon/authenticated の権限を剥奪
--     → ブラウザ（anonキー）からテーブルを直接読み書きできない
--   * 読み書きは oshi_* 関数（security definer）だけ。
--     どの関数も最初に合言葉をチェックし、違えばエラーにする
--   * 合言葉は app_secret に bcrypt ハッシュで1行だけ保存
--     （設定は supabase/set_passphrase.sql を自分で実行）
-- =========================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------

create table if not exists public.works (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 100),
  media      text not null default 'その他' check (char_length(media) <= 20),
  by_name    text not null default '' check (char_length(by_name) <= 30),
  entry      text not null default '' check (char_length(entry) <= 60),   -- まずはここまで
  note       text not null default '' check (char_length(note) <= 500),
  link       text not null default '' check (link = '' or (link ~* '^https?://' and char_length(link) <= 500)),
  homework   boolean not null default false,
  created_at timestamptz not null default now(),
  added_by   text not null default '' check (char_length(added_by) <= 30)
);

create table if not exists public.marks (
  work_id uuid not null references public.works(id) on delete cascade,
  nick    text not null check (char_length(nick) between 1 and 30),
  read    boolean not null default false,
  hit     boolean not null default false,
  primary key (work_id, nick)
);

create table if not exists public.meta (
  key   text primary key check (char_length(key) between 1 and 40),
  value text not null default '' check (char_length(value) <= 200)
);

create table if not exists public.app_secret (
  id   int primary key check (id = 1),   -- 1行だけ
  hash text not null
);

-- （第2弾「旬ネタ」の seasonal はステップ5で追加する）

-- ---------------------------------------------------------
-- 直接アクセスを全部禁止
-- ---------------------------------------------------------

alter table public.works      enable row level security;
alter table public.marks      enable row level security;
alter table public.meta       enable row level security;
alter table public.app_secret enable row level security;

revoke all on table public.works, public.marks, public.meta, public.app_secret
  from public, anon, authenticated;

-- ---------------------------------------------------------
-- 合言葉チェック（内部用。外からは呼べない）
-- ---------------------------------------------------------

create or replace function public.oshi_check(pass text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h text;
begin
  select s.hash into h from public.app_secret s where s.id = 1;
  if h is null or pass is null or extensions.crypt(pass, h) <> h then
    raise exception '合言葉が違います' using errcode = '28P01';
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 公開関数（RPC）
-- ---------------------------------------------------------

-- 全部まとめて取得：{ works: [...], marks: [...], meta: {key: value} }
create or replace function public.oshi_get(pass text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.oshi_check(pass);
  return jsonb_build_object(
    'works', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.created_at desc)
      from public.works w), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(to_jsonb(m))
      from public.marks m), '[]'::jsonb),
    'meta', coalesce((
      select jsonb_object_agg(x.key, x.value)
      from public.meta x), '{}'::jsonb)
  );
end;
$$;

-- 登録・編集：p_id が null なら新規。p_homework が null なら宿題フラグは変えない。
-- 戻り値は作品の id。
create or replace function public.oshi_save_work(
  pass       text,
  p_id       uuid    default null,
  p_title    text    default null,
  p_media    text    default null,
  p_by_name  text    default null,
  p_entry    text    default null,
  p_note     text    default null,
  p_link     text    default null,
  p_homework boolean default null,
  p_added_by text    default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_link text := btrim(coalesce(p_link, ''));
begin
  perform public.oshi_check(pass);

  if v_link !~* '^https?://' then
    v_link := '';
  end if;

  if p_id is null then
    insert into public.works (title, media, by_name, entry, note, link, homework, added_by)
    values (
      btrim(coalesce(p_title, '')),
      coalesce(nullif(btrim(p_media), ''), 'その他'),
      btrim(coalesce(p_by_name, '')),
      btrim(coalesce(p_entry, '')),
      btrim(coalesce(p_note, '')),
      v_link,
      coalesce(p_homework, false),
      btrim(coalesce(p_added_by, ''))
    )
    returning id into v_id;
  else
    update public.works set
      title    = coalesce(btrim(p_title), title),
      media    = coalesce(nullif(btrim(p_media), ''), media),
      by_name  = coalesce(btrim(p_by_name), by_name),
      entry    = coalesce(btrim(p_entry), entry),
      note     = coalesce(btrim(p_note), note),
      link     = case when p_link is null then link else v_link end,
      homework = coalesce(p_homework, homework)
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception '作品が見つかりません' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.oshi_delete_work(pass text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.oshi_check(pass);
  delete from public.works where id = p_id;   -- marks は cascade で消える
end;
$$;

-- 読んだ／刺さった。両方 false なら行を消す。
create or replace function public.oshi_mark(
  pass      text,
  p_work_id uuid,
  p_nick    text,
  p_read    boolean,
  p_hit     boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_nick text := btrim(coalesce(p_nick, ''));
begin
  perform public.oshi_check(pass);

  if v_nick = '' then
    raise exception '呼び名が空です' using errcode = '22023';
  end if;

  if not coalesce(p_read, false) and not coalesce(p_hit, false) then
    delete from public.marks where work_id = p_work_id and nick = v_nick;
  else
    insert into public.marks (work_id, nick, read, hit)
    values (p_work_id, v_nick, coalesce(p_read, false), coalesce(p_hit, false))
    on conflict (work_id, nick) do update
      set read = excluded.read, hit = excluded.hit;
  end if;
end;
$$;

-- 次回の開催日など（例：key='date' value='2026-12-21' / key='place' value='いつもの店'）
create or replace function public.oshi_set_meta(pass text, p_key text, p_value text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.oshi_check(pass);
  insert into public.meta (key, value)
  values (btrim(p_key), btrim(coalesce(p_value, '')))
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- ---------------------------------------------------------
-- 関数の実行権限
-- ---------------------------------------------------------

revoke all on function public.oshi_check(text) from public, anon, authenticated;

revoke all on function
  public.oshi_get(text),
  public.oshi_save_work(text, uuid, text, text, text, text, text, text, boolean, text),
  public.oshi_delete_work(text, uuid),
  public.oshi_mark(text, uuid, text, boolean, boolean),
  public.oshi_set_meta(text, text, text)
from public;

grant execute on function
  public.oshi_get(text),
  public.oshi_save_work(text, uuid, text, text, text, text, text, text, boolean, text),
  public.oshi_delete_work(text, uuid),
  public.oshi_mark(text, uuid, text, boolean, boolean),
  public.oshi_set_meta(text, text, text)
to anon, authenticated;
