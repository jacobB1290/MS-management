-- Per-message cost, pulled from Twilio — never estimated.
--
-- Twilio attaches `price` to a Message resource ASYNCHRONOUSLY, after the
-- message reaches a final status and billing is finalized. It is null at send
-- time and for a short window after. We capture it from the status-callback
-- webhook (and a reconciliation pass in the campaign cron) by fetching the
-- Message resource, then store the real billed amount here. Campaign cost is
-- SUM(price) over a campaign's outbound messages.
--
-- `price` is stored exactly as Twilio reports it: a negative number for
-- outbound (it's a charge), in `price_unit` (e.g. USD). Display takes ABS().

alter table public.messages
  add column if not exists price numeric(12, 6),
  add column if not exists price_unit text,
  add column if not exists num_segments integer;

comment on column public.messages.price is
  'Actual amount billed by Twilio, in price_unit. Negative for outbound. NULL until Twilio finalizes billing post-send. Pulled from the Message resource, never estimated.';
comment on column public.messages.price_unit is
  'ISO currency of price (e.g. USD), as reported by Twilio.';
comment on column public.messages.num_segments is
  'Billable SMS segments Twilio split this message into.';
