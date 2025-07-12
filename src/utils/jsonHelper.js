export function extractJSONArray(aiContent) {
  try {
    const start = aiContent.indexOf('[');
    const end = aiContent.lastIndexOf(']') + 1;

    if (start === -1 || end === -1) {
      throw new Error('No JSON array detected');
    }

    let raw = aiContent.slice(start, end);

    // 🧹 Cleanup common formatting issues
    raw = raw
      .replace(/\n/g, '')
      .replace(/\r/g, '')
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/“|”/g, '"')
      .replace(/‘|’/g, "'")
      .replace(/\\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '')
      .replace(/\\"/g, '"')
      .replace(/([a-zA-Z])":\s*\[\[/g, '$1": [['); // Fix nested matrices

    const parsed = JSON.parse(raw);

    const questions = parsed.map((q, i) => {
      let correct = q.correct;

      // 🧠 Normalize correct answers:
      if (Array.isArray(correct)) {
        // If it's triple-nested, unwrap once: [[[...]]] -> [[...]]
        if (correct.length === 1 && Array.isArray(correct[0]) && Array.isArray(correct[0][0])) {
          correct = correct[0];
        }

        // If it's still a matrix, keep as-is (matrix answer)
        if (Array.isArray(correct[0])) {
          // Likely a matrix like [[a, b], [c, d]]
          return {
            questionId: q.questionId || `Q-${i + 1}`,
            question: String(q.question).trim(),
            options: q.options, // matrix options
            correct,
            explanation: q.explanation ? String(q.explanation).trim() : '',
          };
        }

        // Else: it's a normal MCQ with multiple correct options
        correct = correct.map(opt => String(opt));
      } else {
        correct = [String(correct)];
      }

      return {
        questionId: q.questionId || `Q-${i + 1}`,
        question: String(q.question).trim(),
        options: Array.isArray(q.options)
          ? q.options.map(opt => (typeof opt === 'string' ? opt : JSON.stringify(opt)))
          : [],
        correct,
        explanation: q.explanation ? String(q.explanation).trim() : ''
      };
    });

    return questions;
  } catch (err) {
    console.error('[JSON Parse Fallback Failed]', err);
    return null;
  }
}
