export const buildPrompt = ({ grade, subject, totalQuestions, difficulty }) => `
Generate ${totalQuestions} multiple-choice quiz questions for Grade ${grade} students in the subject "${subject}".
The questions should have a difficulty level of ${difficulty}.

Each question should include:
- "questionId" (e.g., "Q-1")
- "question" (the actual question)
- "options" (4 choices: A, B, C, D)
- "correct" (multiple correct answer)
- "explanation" (short explanation why the correct answer is right)

Respond ONLY in valid JSON array format:

[
  {
    "questionId": "Q-1",
    "question": "What is 2 + 2?",
    "options": ["1", "2", "3", "4"],
    "correct": "4",
    "explanation": "2 + 2 equals 4 because it's basic arithmetic."
  }
]
`;
