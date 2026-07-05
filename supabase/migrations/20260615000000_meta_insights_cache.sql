-- Cache de insights do Meta Ads: janela móvel de 90 dias.
-- O cron diário faz upsert dos últimos 2 dias; backfill inicial cobre 90 dias.
-- Para períodos > 90 dias, o app junta dados do cache + chamadas à Graph API.

create table if not exists meta_insights_cache (
  id                              bigint generated always as identity primary key,
  account_id                      text not null,
  level                           text not null check (level in ('account', 'campaign', 'adset', 'ad')),
  entity_id                       text not null,
  entity_name                     text,
  date_start                      date not null,

  -- Métricas numéricas diretas da API (guardadas como vieram — conversão no app)
  spend                           numeric not null default 0,
  impressions                     bigint  not null default 0,
  inline_link_clicks              bigint  not null default 0,
  reach                           bigint           default 0,
  ctr                             numeric          default 0,
  cpm                             numeric          default 0,
  instagram_profile_visits        bigint           default 0,

  -- Arrays de actions/action_values (jsonb para flexibilidade total)
  actions                         jsonb,
  action_values                   jsonb,
  video_p25_watched_actions       jsonb,
  video_p75_watched_actions       jsonb,
  video_p95_watched_actions       jsonb,
  video_thruplay_watched_actions  jsonb,

  synced_at                       timestamptz not null default now()
);

-- Garante upsert idempotente: mesma entidade + data → atualiza, não duplica
create unique index if not exists meta_insights_cache_unique
  on meta_insights_cache (account_id, level, entity_id, date_start);

create index if not exists meta_insights_cache_date_idx
  on meta_insights_cache (date_start);

create index if not exists meta_insights_cache_level_entity_idx
  on meta_insights_cache (level, entity_id);

-- RLS ativo: nenhuma policy pública → só service_role consegue ler/escrever
alter table meta_insights_cache enable row level security;
