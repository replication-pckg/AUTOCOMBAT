from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import logging
from dotenv import load_dotenv

# OpenAI-compatible client (used to call DeepSeek endpoints)
from openai import OpenAI

load_dotenv()

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)

# ---- DeepSeek / OpenAI-compatible configuration ----
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-reasoner")

if not DEEPSEEK_API_KEY:
    raise ValueError("DEEPSEEK_API_KEY is not set in environment variables")

# Create client pointing to DeepSeek (OpenAI-compatible)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)


# ---------- Prompt builder (Answer refinement prompt) ----------
def build_refiner_prompt(original_answer: str, comments_text: str, question_text: str) -> str:
    """
    Builds the exact Answer Refinement prompt per the new requirements:
      - No separate question-context generation
      - No comment summary step
      - Extract improvement-related concerns directly from comments
      - Feed the original question (title + body) directly; model decides whether to use it
    """
    return f"""
You are a Stack Overflow Answer Refiner.

Policy:
- Edit ONLY if comments contain actionable, improvement-related concerns.
- Do NOT add your own corrections or ideas. Do not evaluate technical correctness.
- Even if a suggested change appears incorrect, apply it if it is an actionable improvement request.
- You MAY read/use the question ONLY if needed to resolve those concerns.
- Keep edits minimal, targeted, and concise; preserve original answer structure; SO tone; fenced code when useful.
- Do not fabricate APIs/behavior/version claims. If a detail is not in comments (or necessary question context), do not invent it.
- If concerns conflict, follow the later one based on the order given.

Output JSON only:
{{
  "concerns": ["actionable concerns"],
  "used_question": true/false,
  "change_log": [{{"concern": "...","change":"..."}}],
  "improved_answer": "final answer text"
}}

User Prompt Template:
Original Answer: {original_answer}
Comments (mix of actionable + generic; order preserved as provided): {comments_text}
Question (use ONLY if needed): {question_text}

Tasks:
1) Extract only actionable improvement concerns from comments (ignore thanks, jokes, meta, vague remarks).
2) Set used_question=true if you needed the question to resolve concerns; else false.
3) Produce a revised answer addressing ONLY those concerns; minimal edits; keep helpful structure.
4) If no actionable concerns, return the original answer unchanged.
5) If concerns conflict, follow the later one based on the order given.

Return ONLY the JSON object described above. No extra prose.
""".strip()


@app.route("/", methods=["GET"])
def root():
    return jsonify({"message": "AUTOCOMBAT server running with DeepSeek refiner"})


@app.route("/process", methods=["POST"])
def process():
    """
    Expected JSON input (backwards-compatible with previous fields):
    {
        // Preferred single-field variant:
        "question": "Full original SO question text",

        // OR legacy fields (will be merged into 'question'):
        "title": "Question title",
        "body": "Question body",

        "answer": "Original answer text",              // required
        "comments": ["c1", "c2", ...]  or  "c1\nc2"    // required; order preserved
    }
    """
    try:
        data = request.get_json(force=True) or {}

        # Accept both new ("question") and legacy ("title"+"body") forms
        question = (data.get("question") or "").strip()
        title = (data.get("title") or "").strip()
        body = (data.get("body") or "").strip()
        if not question:
            question = "\n".join([s for s in [title, body] if s]).strip()

        original_answer = (data.get("answer") or data.get("original_answer") or "").strip()
        comments_raw = data.get("comments", "")

        # Basic validation
        if not original_answer:
            return jsonify({"error": "Answer is a required field"}), 400
        if comments_raw is None or (isinstance(comments_raw, str) and not comments_raw.strip()):
            return jsonify({"error": "Comments are required"}), 400

        # Normalize comments to a list of strings, preserve order
        if isinstance(comments_raw, list):
            comments_list = [str(c).strip() for c in comments_raw if str(c).strip()]
        else:
            # Assume newline-separated string
            comments_list = [line.strip() for line in str(comments_raw).splitlines() if line.strip()]

        comments_text = "\n".join(comments_list)

        # Build the refiner prompt
        prompt = build_refiner_prompt(
            original_answer=original_answer,
            comments_text=comments_text,
            question_text=question
        )

        logging.info("Calling DeepSeek model for refinement...")
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            # Ask for strict JSON when supported
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content if response and response.choices else "{}"

        # Parse as JSON safely; if model returns extra text, try to extract JSON object
        try:
            parsed = json.loads(content)
        except Exception:
            import re
            m = re.search(r"\{[\s\S]*\}", content)
            parsed = json.loads(m.group(0)) if m else {
                "concerns": [],
                "used_question": False,
                "change_log": [],
                "improved_answer": original_answer
            }

        # Ensure required keys exist
        parsed.setdefault("concerns", [])
        parsed.setdefault("used_question", False)
        parsed.setdefault("change_log", [])
        parsed.setdefault("improved_answer", original_answer)

        return jsonify(parsed)

    except Exception as e:
        logging.exception("Error in /process")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # Bind to all interfaces 
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
