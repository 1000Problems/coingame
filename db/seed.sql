-- Curated pool for 1K Daily Coin Pick 'Em: top 20 by market cap as of
-- 2026-07-03 (slickcharts.com/currency), stablecoins and gold-pegged tokens
-- excluded — a $100 chip on a dollar-peg returns $100, which is a non-pick.
-- Names/categories for display only; every price in the game comes from the
-- deterministic fake tape (lib/prices.ts).
insert into coingame_coin (symbol, name, category) values
  ('BTC',  'Bitcoin',      'L1'),
  ('ETH',  'Ethereum',     'L1'),
  ('BNB',  'BNB',          'Exchange'),
  ('XRP',  'XRP',          'Payments'),
  ('SOL',  'Solana',       'L1'),
  ('TRX',  'TRON',         'L1'),
  ('HYPE', 'Hyperliquid',  'DeFi'),
  ('DOGE', 'Dogecoin',     'Meme'),
  ('LEO',  'UNUS SED LEO', 'Exchange'),
  ('ZEC',  'Zcash',        'Privacy'),
  ('XLM',  'Stellar',      'Payments'),
  ('ADA',  'Cardano',      'L1'),
  ('XMR',  'Monero',       'Privacy'),
  ('LINK', 'Chainlink',    'Oracle'),
  ('CC',   'Canton',       'L1'),
  ('GRAM', 'Gram',         'L1'),
  ('BCH',  'Bitcoin Cash', 'Payments'),
  ('LTC',  'Litecoin',     'Payments'),
  ('HBAR', 'Hedera',       'L1'),
  ('SUI',  'Sui',          'L1')
on conflict (symbol) do nothing;
