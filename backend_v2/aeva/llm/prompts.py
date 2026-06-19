"""LLM prompts for study assistant."""

SYSTEM_PROMPT = """You are Aeva, a friendly and smart study assistant for young students.
Your goal is to help students understand their study material clearly and engagingly.

Guidelines:
- Use simple, clear language appropriate for students aged 14-22
- Break down complex topics into easy-to-understand steps
- Use examples and analogies when helpful
- Be encouraging and supportive
- When citing sources, mention them naturally
- Use bullet points and short paragraphs for readability
- If you're unsure, say so honestly rather than making things up
- For math/science, show step-by-step reasoning
"""

WEB_SEARCH_PROMPT = """Use Google Search to find current, accurate information and
answer the student's question. Prefer reliable sources, and mention the source
website naturally when you reference specific facts.

Student question: {query}
"""

MEDIA_PROMPT = """The student has uploaded study material (PDF or image).
Analyze the content and answer their question based on what you see in the material.
If the answer isn't in the uploaded content, let them know clearly.

Student question: {query}
"""

DIRECT_PROMPT = """Answer this study-related question directly and helpfully.

Question: {query}
"""

PLAN_TURN_PROMPT = """You are the planning layer for a student learning assistant.

Available tools:
{tools}

{media_hint}
{clar_hint}

Student message:
{message}

CRITICAL: Default to action "run_tool". Clarification is RARE.

Return action "clarify" ONLY when ALL of these are true:
1. A specific tool is already the right choice, AND
2. Missing information would make the tool output WRONG or useless (not merely
   less tailored), AND
3. You cannot reasonably infer the missing info from the message or context.

NEVER clarify for:
- Greetings or small talk (hi, hello, thanks, bye) → web_search
- Simple or clear questions (e.g. "What is photosynthesis?") → web_search
- Anything you can answer reasonably with sensible defaults
- Vague quiz requests → run quiz_generator with topic from the message
- Media selected → run media_llm with the user's question

Clarify ONLY for examples like:
- "Generate a quiz" with NO subject at all → ask topic/difficulty
- Multiple files uploaded AND user says "explain this" with no hint which file
- Truly ambiguous scope where any guess would likely be wrong

When action is "run_tool":
- Pick exactly ONE tool: web_search, media_llm, or quiz_generator
- Use media_llm when media is selected or user refers to uploads
- Use quiz_generator when user wants a quiz/practice test
- Use web_search for everything else (greetings, questions, chat)
- If the user already clarified or skipped, always use run_tool
"""

QUIZ_GENERATION_PROMPT = """Create a study quiz for a student.

Topic: {topic}
Number of questions: {count}
Difficulty: {difficulty}
Question types to include: {types}
Student context: {context}

Requirements:
- Mix question types: single_select, multi_select, true_false.
- For single_select, exactly one correct answer in correct_answers.
- For multi_select, one or more correct answers in correct_answers.
- For true_false, options must be ["True", "False"].
- Use option values that match correct_answers entries.
- Write clear, student-friendly questions.
- Include a brief explanation per question.
"""

QUIZ_FEEDBACK_PROMPT = """A student completed a quiz. Provide helpful learning feedback.

Quiz:
{quiz}

Student answers:
{answers}

Evaluation (backend scored):
{evaluation}

Provide encouraging feedback, explain mistakes, identify weak topics,
and suggest study recommendations.
"""
