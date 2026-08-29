"""Invariants for the LIVE profile's response shaping — the part that breaks when
real caps (echo.swarm.ask / echo.knowledge.search) replace the stub. Pure functions,
no network. Run: python3 tests/test_live_adapters.py
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from echo_fusion_worker.live_adapters import (shape_model_text, shape_search_hits,  # noqa: E402
                                              extract_swarm_answer, extract_search_body)


async def l01_findings_prompt_wraps_real_answer_as_finding():
    prompt = 'first pass. Return ONLY a JSON object: {"findings":[{"claim":"..."}]}'
    text = shape_model_text(prompt, "Austin is the capital of Texas.", 0.72)
    doc = json.loads(text)
    f = doc["findings"][0]
    assert f["claim"] == "Austin is the capital of Texas.", "real answer lost"
    assert abs(f["confidence"] - 0.72) < 1e-9, "real swarm confidence not carried"


async def l02_fusion_prompt_wraps_answer_json():
    prompt = 'Return ONLY JSON: {"answer":"...","confidence":0.0}'
    text = shape_model_text(prompt, "Austin.", 0.5)
    doc = json.loads(text)
    assert doc["answer"] == "Austin.", "fusion answer lost"
    assert "confidence" in doc


async def l03_decompose_prompt_passes_through():
    prompt = "Decompose the objective into independent subproblems. Return a JSON array of short strings."
    text = shape_model_text(prompt, '["a","b"]', 0.5)
    # engine's _decompose parses a JSON array itself; we must not mangle it.
    assert json.loads(text) == ["a", "b"]


async def l04_confidence_clamped():
    text = shape_model_text('{"findings"', "x", 9.0)
    assert json.loads(text)["findings"][0]["confidence"] <= 1.0


async def l05_extract_swarm_answer_from_real_envelope():
    env = {"result": {"body": {"final_answer": "Austin.", "confidence": 0.45}}}
    ans, conf = extract_swarm_answer(env)
    assert ans == "Austin." and abs(conf - 0.45) < 1e-9


async def l06_extract_swarm_answer_missing_defaults():
    ans, conf = extract_swarm_answer({"result": {"body": {}}})
    assert isinstance(ans, str) and 0.0 <= conf <= 1.0


async def l07_search_hits_to_memory_records():
    body = {"hits": [
        {"snippet": "Austin is the capital.", "path": "/doc/a.md", "chunk_idx": 3,
         "document_id": 5038, "title": "TX facts", "hybrid_score": 0.81},
    ]}
    recs = shape_search_hits(body)
    assert len(recs) == 1
    r = recs[0]
    assert r["content"] == "Austin is the capital."
    assert r["source"] == "TX facts"
    assert "5038" in r["id"] and r["score"] == 0.81


async def l08_extract_search_body_unwraps_envelope():
    env = {"result": {"body": {"hits": [{"snippet": "s", "path": "p", "document_id": 1,
                                          "chunk_idx": 0, "title": "t", "hybrid_score": 0.1}]}}}
    body = extract_search_body(env)
    assert body["hits"][0]["snippet"] == "s"


async def l09_empty_search_is_empty_list_not_crash():
    assert shape_search_hits({"hits": []}) == []
    assert shape_search_hits({}) == []


TESTS = [l01_findings_prompt_wraps_real_answer_as_finding, l02_fusion_prompt_wraps_answer_json,
         l03_decompose_prompt_passes_through, l04_confidence_clamped,
         l05_extract_swarm_answer_from_real_envelope, l06_extract_swarm_answer_missing_defaults,
         l07_search_hits_to_memory_records, l08_extract_search_body_unwraps_envelope,
         l09_empty_search_is_empty_list_not_crash]


async def main():
    fails = 0
    for t in TESTS:
        try:
            await t()
            print("PASS", t.__name__)
        except Exception as e:  # noqa: BLE001
            fails += 1
            import traceback
            print("FAIL", t.__name__, "::", repr(e))
            traceback.print_exc()
    print("")
    print("ALL GREEN" if not fails else f"{fails}/{len(TESTS)} FAILING")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
