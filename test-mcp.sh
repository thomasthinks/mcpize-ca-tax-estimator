#!/bin/bash
# MCP Protocol Smoke Test for ca-tax-estimator
# Usage: Start the server first (PORT=8080 npm run dev), then: bash test-mcp.sh
# Or against a running server: MCP_URL=http://localhost:8080 bash test-mcp.sh

BASE_URL="${MCP_URL:-http://localhost:8080}"
MCP_ENDPOINT="$BASE_URL/mcp"
HEALTH_ENDPOINT="$BASE_URL/health"
PASSED=0
FAILED=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}FAIL${NC} $1: $2"; FAILED=$((FAILED + 1)); }

mcp_call() {
  # $1 = id, $2 = JSON-RPC body
  curl -sf -X POST "$MCP_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$2" 2>/dev/null || true
}

echo "Testing ca-tax-estimator at $BASE_URL"
echo "================================"

echo ""
echo "--- Health Check ---"
HEALTH=$(curl -sf "$HEALTH_ENDPOINT" 2>/dev/null) || true
if echo "$HEALTH" | grep -q "healthy"; then
  pass "GET /health returns healthy"
else
  fail "GET /health" "Expected 'healthy' in response, got: $HEALTH"
fi

echo ""
echo "--- MCP Initialize ---"
INIT_RESPONSE=$(mcp_call 1 '{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-03-26", "capabilities": {},
              "clientInfo": { "name": "smoke-test", "version": "1.0" } }
}') || true
if echo "$INIT_RESPONSE" | grep -q '"result"'; then
  pass "initialize returns result"
else
  fail "initialize" "No 'result' in response"
fi

echo ""
echo "--- List Tools ---"
TOOLS_RESPONSE=$(mcp_call 2 '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
}') || true
if echo "$TOOLS_RESPONSE" | grep -q '"tools"'; then
  pass "tools/list returns tools array"
  TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['result']['tools']))" 2>/dev/null || echo "?")
  echo "     Found $TOOL_COUNT tool(s)"
else
  fail "tools/list" "No 'tools' in response"
fi

EXPECTED_TOOLS=("estimate_tax" "compare_rrsp_tfsa" "marginal_rate")
for TOOL in "${EXPECTED_TOOLS[@]}"; do
  if echo "$TOOLS_RESPONSE" | grep -q "\"$TOOL\""; then
    pass "Tool '$TOOL' is registered"
  else
    fail "Tool '$TOOL'" "Not found in tools/list response"
  fi
done

echo ""
echo "--- Call estimate_tax(100000, ON) ---"
CALL_RESPONSE=$(mcp_call 3 '{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "estimate_tax", "arguments": { "income": 100000, "province": "ON" } }
}') || true
TOTAL=$(echo "$CALL_RESPONSE" | python3 -c "
import sys, json
r = json.load(sys.stdin)['result']
sc = r.get('structuredContent') or {}
print(sc.get('total_tax', 'MISSING'))
" 2>/dev/null || echo "PARSE_ERROR")
echo "     total_tax = $TOTAL (expect ~21520.55)"
if [ "$TOTAL" != "MISSING" ] && [ "$TOTAL" != "PARSE_ERROR" ]; then
  OK=$(python3 -c "print(abs(float('$TOTAL') - 21520.55) < 1.0)" 2>/dev/null || echo "False")
  if [ "$OK" = "True" ]; then
    pass "estimate_tax(100000, ON) total within \$1 of \$21,520.55"
  else
    fail "estimate_tax(100000, ON)" "total_tax=$TOTAL, expected ~21520.55"
  fi
else
  fail "estimate_tax(100000, ON)" "No total_tax in structuredContent"
fi

echo ""
echo "--- Call compare_rrsp_tfsa ---"
RRSP_RESPONSE=$(mcp_call 4 '{
  "jsonrpc": "2.0", "id": 4, "method": "tools/call",
  "params": { "name": "compare_rrsp_tfsa",
              "arguments": { "income": 100000, "province": "ON", "contribution": 10000 } }
}') || true
SAVING=$(echo "$RRSP_RESPONSE" | python3 -c "
import sys, json
r = json.load(sys.stdin)['result']
print((r.get('structuredContent') or {}).get('rrsp_tax_saving', 'MISSING'))
" 2>/dev/null || echo "PARSE_ERROR")
echo "     rrsp_tax_saving = $SAVING (expect 2965)"
if [ "$SAVING" = "2965" ] || [ "$SAVING" = "2965.0" ]; then
  pass "compare_rrsp_tfsa saving = contribution x marginal rate"
else
  fail "compare_rrsp_tfsa" "rrsp_tax_saving=$SAVING, expected 2965"
fi

echo ""
echo "--- Call marginal_rate ---"
MARG_RESPONSE=$(mcp_call 5 '{
  "jsonrpc": "2.0", "id": 5, "method": "tools/call",
  "params": { "name": "marginal_rate", "arguments": { "income": 60000, "province": "BC" } }
}') || true
MARG=$(echo "$MARG_RESPONSE" | python3 -c "
import sys, json
r = json.load(sys.stdin)['result']
print((r.get('structuredContent') or {}).get('marginal_rate', 'MISSING'))
" 2>/dev/null || echo "PARSE_ERROR")
echo "     marginal_rate = $MARG (expect 0.282)"
if [ "$MARG" = "0.282" ]; then
  pass "marginal_rate(60000, BC) = 0.282 (20.5% + 7.7%)"
else
  fail "marginal_rate" "marginal_rate=$MARG, expected 0.282"
fi

echo ""
echo "--- Invalid province -> graceful isError ---"
ERR_RESPONSE=$(mcp_call 6 '{
  "jsonrpc": "2.0", "id": 6, "method": "tools/call",
  "params": { "name": "estimate_tax", "arguments": { "income": 50000, "province": "XX" } }
}') || true
if echo "$ERR_RESPONSE" | grep -q '"isError":true'; then
  pass "invalid province returns isError:true"
else
  fail "invalid province" "Expected isError:true"
fi

echo ""
echo "--- Ping ---"
PING_RESPONSE=$(mcp_call 7 '{"jsonrpc": "2.0", "id": 7, "method": "ping", "params": {}}') || true
if echo "$PING_RESPONSE" | grep -q '"result"'; then
  pass "ping returns result"
else
  fail "ping" "No 'result' in response"
fi

echo ""
echo "================================"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
[ "$FAILED" -gt 0 ] && exit 1
