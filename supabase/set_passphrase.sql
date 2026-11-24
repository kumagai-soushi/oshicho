-- 合言葉の設定・変更用。
-- このファイルは書き換えずに、SQL Editor に貼ってから「ここに合言葉」の部分だけ置き換えて実行する。
-- 本物の合言葉はファイルにもチャットにも書かない。
-- 変更したいときも同じSQLをもう一度実行すればよい（上書きされる）。

insert into public.app_secret (id, hash)
values (1, extensions.crypt('ここに合言葉', extensions.gen_salt('bf')))
on conflict (id) do update set hash = excluded.hash;

-- 確認（正しい合言葉なら JSON が返る。違えば「合言葉が違います」エラー）
-- select public.oshi_get('ここに合言葉');
