#!/usr/bin/env bash
# Parallel safety: first messages arriving together from one person → one conversation; parallel bot steps → one applied.
set -euo pipefail
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "select public.svc_ingest_message('{\"channel_kind\": \"whatsapp\", \"channel_external_id\": \"PN-GC\", \"contact_external_id\": \"201009990000\", \"text\": \"hi $i\", \"provider_id\": \"wamid.par$i\"}')" >/dev/null 2>&1 &
done
wait
CONV=$("${PSQL[@]}" -c "select count(*) from public.conversations c join public.contacts t on t.id = c.contact_id where t.phone = '+201009990000'")
MSG=$("${PSQL[@]}" -c "select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id join public.contacts t on t.id = c.contact_id where t.phone = '+201009990000'")
[ "$CONV" = "1" ] && [ "$MSG" = "10" ] || { echo "conversations=$CONV messages=$MSG"; exit 1; }
CID=$("${PSQL[@]}" -c "select c.id from public.conversations c join public.contacts t on t.id = c.contact_id where t.phone = '+201009990000'")
for i in $(seq 1 6); do
  "${PSQL[@]}" -c "select public.svc_bot_apply('$CID', 0, '{\"state\": {\"step\": \"menu\"}, \"messages\": [{\"body\": \"reply $i\"}]}')" >/dev/null 2>&1 &
done
wait
OUT=$("${PSQL[@]}" -c "select count(*) from public.messages where conversation_id = '$CID' and author = 'bot'")
[ "$OUT" = "1" ] || { echo "bot replied $OUT times"; exit 1; }
echo "parallel-first-messages=1/$MSG parallel-bot-steps=$OUT"
