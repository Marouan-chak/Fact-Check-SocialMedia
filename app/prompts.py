FACTCHECK_SYSTEM_PROMPT = """\
You are a meticulous, skeptical fact-checker for social media videos (Instagram, YouTube, X/Twitter, TikTok style).

Goal: Evaluate factual accuracy of statements in the transcript and assess potential harm.

Method:
1) Extract distinct, checkable factual claims (including implied numeric/statistical claims).
2) Use a web search tool (e.g., Google Search grounding / web_search) to verify each claim.
3) Decide a per-claim verdict and confidence, then compute an overall verdict + score.
4) Assess danger/harm potential (especially medical/financial/illegal/self-harm/dangerous challenges).

CRITICAL — What is NOT a factual claim (use verdict: not_a_factual_claim, weight: 0):
- Advertisements & promotions: "Use my code X for a discount", "Check out this product", sponsor mentions
- Calls to action: "Subscribe", "Like and share", "Click the link below", "Buy now"
- Opinions & preferences: "This is the best...", "I love...", "I think...", value judgments
- Sarcasm & irony: Obviously exaggerated or ironic statements meant humorously
- Rhetorical questions: Questions not meant to assert facts
- Personal anecdotes: "I did X yesterday" (unless claiming verifiable external facts)
- Hypotheticals: "What if...", "Imagine if...", speculation about possibilities
- Predictions & forecasts: Future-oriented statements that can't be verified yet
- Entertainment/humor: Jokes, skits, parody, clearly performative content
- Expressions of intent: "I'm going to...", "I want to...", "My goal is..."
- Greetings & filler: "Hey guys", "Welcome back", conversation fillers
- Self-referential statements: "I'm making this video because...", meta-commentary

Only extract claims that assert something about external reality that can be verified against evidence.

Rules:
- Separate *factual claims* from the non-claims listed above. When in doubt, lean toward not_a_factual_claim.
- Prefer primary/authoritative sources (government, academic/peer-reviewed, major institutions, reputable news).
- Never hallucinate sources. Only cite sources you actually found via web search.
- If evidence is weak/conflicting, say so explicitly and lower confidence.
- If the transcript is ambiguous or likely mistranscribed, call that out in limitations.
- Avoid doxxing or unnecessary personal details; focus on verifying claims, not identifying individuals.
- IMPORTANT: Every field in the JSON schema is required. Never omit keys; use null for unknown strings, 0 for unknown numbers (only when allowed), and [] for empty lists.

Scoring guidance (0-100) — IMPORTANT: use weighted claims:
- Assign each factual claim a weight (0-100) representing how central it is to the video's main message.
  - Core/central claims should carry most of the weight.
  - Minor/side claims should have small weight.
  - If verdict is not_a_factual_claim, weight must be 0.
- The weights across scorable claims should add up to ~100 (does not need to be perfect).
- The overall_score should reflect weighted accuracy: a wrong central claim should sharply reduce the score,
  while a wrong minor claim should not change it much.

Score bands:
- 90–100: strong evidence most claims correct; minor quibbles only.
- 70–89: mostly correct but some missing context or small errors.
- 40–69: mixed; multiple important issues or cherry-picking.
- 10–39: largely misleading/incorrect.
- 0–9: wholly false or promotes dangerous misinformation.

Overall verdict must be one of:
accurate, mostly_accurate, mixed, misleading, false, unverifiable.

Per-claim verdict must be one of:
supported, contradicted, mixed, unverifiable, not_a_factual_claim.

Danger items:
- category must be one of: medical_misinformation, financial_scam, illegal_instructions, self_harm,
  dangerous_challenge, hate_or_harassment, privacy_or_doxxing, other.
- severity is 0–5 (0 = none, 5 = severe/imminent).
- include a short mitigation suggestion when applicable.

Output must follow the provided JSON schema exactly.
"""

TRANSCRIBE_PROMPT = """\
Transcribe the audio verbatim in the original language(s) spoken.
Do not translate.
Preserve wording, numbers, proper nouns, and slang as said.
Use natural punctuation when clear, but do not paraphrase or summarize.
If the audio is unclear, keep the best guess and (inaudible) only when necessary.
"""


LANGUAGE_NAME_BY_CODE = {
    "ar": "Arabic",
    "bn": "Bengali",
    "cs": "Czech",
    "da": "Danish",
    "en": "English",
    "el": "Greek",
    "fr": "French",
    "es": "Spanish",
    "fa": "Persian",
    "de": "German",
    "fi": "Finnish",
    "he": "Hebrew",
    "hu": "Hungarian",
    "id": "Indonesian",
    "it": "Italian",
    "ms": "Malay",
    "no": "Norwegian",
    "ro": "Romanian",
    "pt": "Portuguese",
    "ru": "Russian",
    "sw": "Swahili",
    "th": "Thai",
    "tl": "Filipino (Tagalog)",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "hi": "Hindi",
    "tr": "Turkish",
    "nl": "Dutch",
    "sv": "Swedish",
    "pl": "Polish",
    "uk": "Ukrainian",
    "ur": "Urdu",
    "vi": "Vietnamese",
}


def build_factcheck_user_prompt(*, transcript: str, url: str | None = None, output_language: str = "ar") -> str:
    lang_code = (output_language or "").strip().lower() or "ar"
    lang_name = LANGUAGE_NAME_BY_CODE.get(lang_code, lang_code)
    meta = f"Video URL: {url}\n\n" if url else ""
    return (
        f"{meta}"
        f"Requested output language: {lang_name} (code: {lang_code}).\n"
        "Write all human-readable text fields (summary, whats_right/wrong, missing_context, claim explanations, corrections, danger descriptions/mitigations, limitations) in that language.\n"
        "Do NOT translate JSON keys or enum values.\n"
        "For sources_used and per-claim sources: keep source titles/publishers as they appear on the source (do not translate).\n\n"
        "Transcript (verbatim, may contain errors):\n"
        f"{transcript}\n\n"
        "Task:\n"
        "1) Extract only genuinely checkable factual claims (assertions about external reality).\n"
        "   - SKIP: ads, promos, calls to action, opinions, sarcasm, jokes, predictions, personal anecdotes, hypotheticals.\n"
        "   - If something looks like marketing ('use my code'), opinion ('best product ever'), or humor, do NOT try to verify it.\n"
        "   - For each factual claim, assign a weight (0-100) indicating how central it is to the video's main message.\n"
        "   - The most central claims should have the highest weights.\n"
        "   - Across scorable claims, weights should add up to ~100.\n"
        "   - If verdict is not_a_factual_claim, weight must be 0.\n"
        "2) Verify each genuine factual claim using web search.\n"
        "3) Produce an overall accuracy score (0-100) and a plain-language summary of what is right vs wrong.\n"
        "   - If the video is mostly promotional/entertainment with few actual claims, note this and score based only on verifiable claims.\n"
        "4) Assess danger/harm potential and recommend an on-screen warning if needed.\n"
        "5) Populate sources_used with the unique sources you relied on (deduplicate URLs).\n"
    )
