#!/usr/bin/env bash
# Usage:
#   CRM_URL=https://crm.local \
#   ADMIN_KEY=crm_... HERMES_KEY=crm_... OPENCLAW_KEY=crm_... \
#   scripts/smoke-startos.sh
#
# ADMIN_KEY is a crm_integration key (creates the test contact).
# HERMES_KEY and OPENCLAW_KEY are agent_propose keys.
# Everything goes through the web origin: MCP at /api/mcp and tRPC at /api/trpc,
# which is all StartOS exposes. Needs curl and jq. Leaves one contact and two
# pending proposals behind, all named smoke-<run id>, for you to approve on the
# Sales page.
set -euo pipefail

: "${CRM_URL:?set CRM_URL, e.g. https://crm.local}"
: "${ADMIN_KEY:?set ADMIN_KEY (a crm_integration key)}"
: "${HERMES_KEY:?set HERMES_KEY (an agent_propose key)}"
: "${OPENCLAW_KEY:?set OPENCLAW_KEY (an agent_propose key)}"

run_id="${RUN_ID:-$(date +%s)}"
base="${CRM_URL%/}"
failures=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

mcp() {
  local key="$1" tool="$2" args="$3"
  curl -sS "$base/api/mcp" \
    -H "Authorization: Bearer $key" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}"
}

# A successful tool call answers {"result":{"content":[{"text":"<json>"}]}}; a
# refused one answers {"result":{"isError":true,"content":[{"text":"CODE: ..."}]}}.
mcp_text() { jq -r '.result.content[0].text // .error.message'; }
mcp_is_error() { jq -e '.result.isError == true' >/dev/null; }

trpc_mutation() {
  local key="$1" procedure="$2" body="$3"
  curl -sS -o /dev/null -w '%{http_code}' -X POST "$base/api/trpc/$procedure" \
    -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
    -d "$body"
}

echo "== smoke $run_id against $base"

contact_args=$(jq -cn --arg r "$run_id" \
  '{firstName:"Smoke", lastName:$r, email:("smoke-"+$r+"@example.invalid"), title:"Buyer"}')
created=$(mcp "$ADMIN_KEY" create_contact "$contact_args")
if echo "$created" | mcp_is_error; then
  fail "admin key could not create a contact: $(echo "$created" | mcp_text)"
  exit 1
fi
contact_id=$(echo "$created" | mcp_text | jq -r '.id')
pass "admin key created contact $contact_id"

for label in HERMES OPENCLAW; do
  key="${!label"_KEY"}"
  if mcp "$key" create_contact "$contact_args" | mcp_is_error; then
    pass "$label key cannot create a contact"
  else
    fail "$label key created a contact; an agent_propose key must not"
  fi
done

for label in HERMES OPENCLAW; do
  key="${!label"_KEY"}"
  hits=$(mcp "$key" search_crm "{\"q\":\"smoke-$run_id\"}" | mcp_text \
    | jq -r --arg id "$contact_id" '[.. | objects | select(.id? == $id)] | length')
  if [ "${hits:-0}" -ge 1 ]; then
    pass "$label key finds the contact over MCP"
  else
    fail "$label key did not find the contact over MCP"
  fi
done

source_note="Head of Procurement. Send the revised quote. Prefers email."
declare -A proposal_key

for label in HERMES OPENCLAW; do
  key="${!label"_KEY"}"
  revision=$(mcp "$ADMIN_KEY" get_contact "{\"id\":\"$contact_id\"}" | mcp_text | jq -r '.updatedAt')
  request_args=$(jq -cn --arg s "$source_note" --arg c "$contact_id" --arg r "$revision" \
    '{source:$s, candidateIds:[$c], expectedUpdatedAt:$r, profileId:"qwen-local-experimental", profileRevision:"sales-qwen-v1"}')
  request=$(mcp "$key" sales_create_request "$request_args")
  if echo "$request" | mcp_is_error; then
    fail "$label key could not create a sales request: $(echo "$request" | mcp_text)"
    continue
  fi
  request_id=$(echo "$request" | mcp_text | jq -r '.id')
  pass "$label key created sales request $request_id"

  ops=$(jq -cn --arg c "$contact_id" \
    '[{type:"contact_fact",contactId:$c,field:"jobTitle",value:"Head of Procurement",evidence:"Head of Procurement"},
      {type:"create_task",contactId:$c,field:null,value:"Send the revised quote",evidence:"Send the revised quote"}]')
  store_args=$(jq -cn --arg r "$request_id" --argjson o "$ops" --arg p "smoke/$label" \
    '{requestId:$r, operations:$o, producedBy:$p}')
  proposal=$(mcp "$key" sales_store_proposal "$store_args")
  if echo "$proposal" | mcp_is_error; then
    fail "$label key could not store a proposal: $(echo "$proposal" | mcp_text)"
    continue
  fi
  proposal_id=$(echo "$proposal" | mcp_text | jq -r '.id')
  idem=$(echo "$proposal" | mcp_text | jq -r '.idempotencyKey')
  pass "$label key stored proposal $proposal_id"

  code=$(trpc_mutation "$key" sales.approveProposal \
    "{\"proposalId\":\"$proposal_id\",\"idempotencyKey\":\"$idem\"}")
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    pass "$label key cannot approve ($code)"
  else
    fail "$label key approval returned $code; expected 401 or 403"
  fi

  stored=$(mcp "$key" sales_get_request "{\"requestId\":\"$request_id\"}" | mcp_text)
  key_id=$(echo "$stored" | jq -r '.proposal.proposedByKeyId // empty')
  produced=$(echo "$stored" | jq -r '.proposal.producedBy // empty')
  request_key=$(echo "$stored" | jq -r '.requestedByKeyId // empty')
  if [ -n "$key_id" ] && [ "$produced" = "smoke/$label" ] && [ "$request_key" = "$key_id" ]; then
    pass "$label proposal and request are attributed to key $key_id, produced by $produced"
    proposal_key[$label]="$key_id"
  else
    fail "$label proposal lacks attribution: $stored"
  fi
done

if [ -n "${proposal_key[HERMES]:-}" ] && [ -n "${proposal_key[OPENCLAW]:-}" ] \
  && [ "${proposal_key[HERMES]}" != "${proposal_key[OPENCLAW]}" ]; then
  pass "the two agents are attributed to different keys"
else
  fail "the two proposals are not attributed to two different keys"
fi

echo "== $failures failure(s). Approve the proposals on the Sales page to finish the loop."
exit "$failures"
