"""Quiz options are shuffled before a quiz is stored (pure; no LLM or DB)."""

from aeva.quiz.option_order import shuffle_options


def _question(**overrides: object) -> dict:
    return {
        "type": "single_select",
        "prompt": "Which organelle makes ATP?",
        "options": ["Nucleus", "Mitochondrion", "Ribosome", "Golgi body"],
        "correct_answers": ["Mitochondrion"],
        "explanation": "Mitochondria carry out aerobic respiration.",
        **overrides,
    }


def _orders(question: dict, runs: int = 60) -> set[tuple[str, ...]]:
    """Option orders across ``runs`` differently worded copies of a question."""
    variants = [
        {**question, "prompt": f"{question['prompt']} (v{i})"}
        for i in range(runs)
    ]
    return {tuple(q["options"]) for q in shuffle_options(variants)}


class TestShuffleOptions:
    def test_options_are_reordered_and_the_answer_is_untouched(self):
        question = _question()
        orders = _orders(question)
        assert len(orders) > 1
        for order in orders:
            assert sorted(order) == sorted(question["options"])
        out = shuffle_options([question])[0]
        assert out["correct_answers"] == ["Mitochondrion"]
        assert out["explanation"] == question["explanation"]

    def test_correct_option_reaches_every_position(self):
        positions = {
            order.index("Mitochondrion") for order in _orders(_question(), 200)
        }
        assert positions == {0, 1, 2, 3}

    def test_same_question_always_gets_the_same_order(self):
        first = shuffle_options([_question()])[0]["options"]
        for _ in range(5):
            assert shuffle_options([_question()])[0]["options"] == first

    def test_input_is_not_mutated(self):
        question = _question()
        before = list(question["options"])
        shuffle_options([question])
        assert question["options"] == before

    def test_true_false_keeps_its_order(self):
        question = _question(
            type="true_false", options=["True", "False"],
            correct_answers=["False"],
        )
        assert _orders(question) == {("True", "False")}

    def test_positional_options_keep_their_order(self):
        for last in ("All of the above", "None of these", "Both A and B"):
            question = _question(options=["Nucleus", "Ribosome", "Golgi", last])
            assert len(_orders(question)) == 1, last

    def test_explanation_naming_an_option_keeps_the_order(self):
        question = _question(explanation="Option B is correct because...")
        assert len(_orders(question)) == 1

    def test_multi_select_is_shuffled(self):
        question = _question(
            type="multi_select", correct_answers=["Nucleus", "Ribosome"]
        )
        assert len(_orders(question)) > 1
