-- Curated pool for 1K Daily Coin Pick 'Em: top 10 by market cap as of
-- 2026-07-03 (slickcharts.com/currency), stablecoins/pegged excluded, with two
-- edits (TASK-coingame-07): LEO out (exchange IOU, barely moves — dead pick),
-- ZEC out (third yellow, unreadable chips); LINK and HBAR in.
-- color = fixed brand color, same on every screen. Names/categories/colors are
-- display only; every price comes from the deterministic tape (lib/prices.ts).
insert into coingame_coin (symbol, name, category, color) values
  ('BTC',  'Bitcoin',     'L1',       '#F7931A'),
  ('ETH',  'Ethereum',    'L1',       '#627EEA'),
  ('BNB',  'BNB',         'Exchange', '#F0B90B'),
  ('XRP',  'XRP',         'Payments', '#00AAE4'),
  ('SOL',  'Solana',      'L1',       '#9945FF'),
  ('TRX',  'TRON',        'L1',       '#EB0029'),
  ('HYPE', 'Hyperliquid', 'DeFi',     '#2EBFA5'),
  ('DOGE', 'Dogecoin',    'Meme',     '#C2A633'),
  ('LINK', 'Chainlink',   'Oracle',   '#2A5ADA'),
  ('HBAR', 'Hedera',      'L1',       '#3B3F46')
on conflict (symbol) do nothing;
-- (Palette or pool changes on a live DB: edit rows manually or rebuild. An
-- upsert clause here would trip seed.mjs's write-guard regex — keep do-nothing.)
