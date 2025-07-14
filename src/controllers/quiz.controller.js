import prisma from '../config/db.js';
import { parseISO, startOfDay, endOfDay } from 'date-fns';
import { z } from 'zod';
import openai from '../utils/groq.js';
import { buildPrompt } from '../utils/promptBuilder.js';
import { extractJSONArray } from '../utils/jsonHelper.js';
import { sendResultEmail } from '../utils/email.js';

const quizInputSchema = z.object({
    grade: z.number().min(1).max(12),
    subject: z.string().min(1),
    totalQuestions: z.number().min(1).max(50),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD'])
});

export const generateQuiz = async (req, res) => {
    try {
        const { grade, subject, totalQuestions, difficulty } =
            quizInputSchema.parse(req.body);

        const prompt = buildPrompt({ grade, subject, totalQuestions, difficulty });

        const response = await openai.chat.completions.create({
            model: 'llama3-70b-8192',
            messages: [
                { role: 'system', content: 'You are an AI quiz generator.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7
        });

        const aiContent = response.choices[0]?.message?.content?.trim();
        let generatedQuestions = extractJSONArray(aiContent);

        if (!generatedQuestions) {
            console.error('[AI JSON Parse Error]', aiContent);
            return res.status(500).json({ error: 'AI returned invalid JSON format' });
        }

        // ✅ Auto calculate max score
        const maxScore = generatedQuestions.reduce((sum, q) => {
            const correct = q.correct;
            return sum + (Array.isArray(correct) ? correct.length : 1);
        }, 0);

        const quiz = await prisma.quiz.create({
            data: {
                grade: grade.toString(),
                subject,
                difficulty,
                totalQuestions,
                maxScore,
                questions: generatedQuestions,
                createdBy: req.user?.username || null
            }
        });

        return res.status(201).json({ message: 'Quiz generated successfully', quiz });

    } catch (err) {
        console.error('[Quiz Generation Error]', err);
        if (err.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid input', details: err.errors });
        }
        return res.status(500).json({ error: 'Something went wrong' });
    }
};


const submissionInputSchema = z.object({
    quizId: z.string().uuid(),
    answers: z.array(z.object({
        questionId: z.string(),
        userResponse: z.union([z.string(), z.array(z.string())])
    }))
});


export const submitQuiz = async (req, res) => {
  try {
    const { quizId, answers } = submissionInputSchema.parse(req.body);

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.email) return res.status(400).json({ error: 'User email not found' });

    let score = 0;
    const questions = quiz.questions;

    answers.forEach(ans => {
      const q = questions.find(q => q.questionId === ans.questionId);
      if (!q) return;

      const correctAnswers = Array.isArray(q.correct) ? q.correct : [q.correct];
      const userResponses = Array.isArray(ans.userResponse) ? ans.userResponse : [ans.userResponse];

      const correctCount = userResponses.filter(r => correctAnswers.includes(r)).length;
      score += correctCount;
    });

    const submission = await prisma.submission.create({
      data: {
        quizId,
        userId: req.user.id,
        answers,
        score
      }
    });

    // 🔥 Generate AI Suggestions based on performance
    const feedbackPrompt = `
A student scored ${score} out of ${quiz.maxScore} on a grade ${quiz.grade} ${quiz.subject} quiz.
Based on this performance, suggest TWO specific topics or skills they should focus on to improve.
Provide suggestions in plain bullet points.
`;

    const feedbackAI = await openai.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: 'You are a helpful tutor providing feedback.' },
        { role: 'user', content: feedbackPrompt }
      ],
      temperature: 0.6
    });

    const suggestions = feedbackAI.choices[0]?.message?.content?.trim() || 'No suggestions available.';

    // 📧 Send Email
    const emailContent = `
      <h2>Quiz Result: ${quiz.subject} (Grade ${quiz.grade})</h2>
      <p>Dear ${user.username},</p>
      <p>You scored <strong>${score}</strong> out of <strong>${quiz.maxScore}</strong>.</p>
      <h3>Suggestions to Improve:</h3>
      <pre>${suggestions}</pre>
      <br/>
      <p>Keep learning!</p>
      <p><strong>AI Quizzer Team</strong></p>
    `;

    await sendResultEmail({
      to: user.email,
      subject: 'Your Quiz Result & Suggestions',
      html: emailContent
    });

    return res.status(201).json({
      message: 'Quiz submitted successfully and result emailed.',
      score,
      total: quiz.maxScore,
      submission
    });

  } catch (err) {
    console.error('[Submit Quiz Error]', err);
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Something went wrong' });
  }
};


export const getQuizHistory = async (req, res) => {
    try {
        const {
            grade,
            subject,
            minScore,
            maxScore,
            from,
            to
        } = req.query;

        const filters = {
            userId: req.user.id,
            ...(minScore && { score: { gte: parseInt(minScore) } }),
            ...(maxScore && { score: { lte: parseInt(maxScore) } }),
            ...(from && to && {
                completedAt: {
                    gte: startOfDay(parseISO(from)),
                    lte: endOfDay(parseISO(to))
                }
            })
        };

        const submissions = await prisma.submission.findMany({
            where: filters,
            include: {
                quiz: true
            },
            orderBy: {
                completedAt: 'desc'
            }
        });

        // Apply quiz-based filtering in JS
        const filtered = submissions.filter(sub => {
            const quiz = sub.quiz;
            if (grade && quiz.grade !== grade.toString()) return false;
            if (subject && quiz.subject.toLowerCase() !== subject.toLowerCase()) return false;
            return true;
        });

        res.json({ total: filtered.length, submissions: filtered });

    } catch (err) {
        console.error('[Get Quiz History Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const retryInputSchema = z.object({
    answers: z.array(
        z.object({
            questionId: z.string(),
            userResponse: z.union([
                z.string(),
                z.array(z.string()),
                z.array(z.array(z.string()))
            ])
        })
    )
});


export const retryQuiz = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers } = retryInputSchema.parse(req.body);

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.email) return res.status(400).json({ error: 'User email not found' });

    const questions = quiz.questions;
    let score = 0;

    answers.forEach(ans => {
      const q = questions.find(q => q.questionId === ans.questionId);
      if (!q) return;

      const correctAnswers = Array.isArray(q.correct) ? q.correct : [q.correct];
      const userResponses = Array.isArray(ans.userResponse) ? ans.userResponse : [ans.userResponse];

      const correctCount = userResponses.filter(r => correctAnswers.includes(r)).length;
      score += correctCount;
    });

    const newSubmission = await prisma.submission.create({
      data: {
        quizId,
        userId: req.user.id,
        answers,
        score
      }
    });

    // 🔁 AI Feedback Prompt
    const feedbackPrompt = `
A student retried a quiz and scored ${score} out of ${quiz.maxScore} on a grade ${quiz.grade} ${quiz.subject} quiz.
Based on this performance, suggest TWO specific areas or skills they should focus on to improve.
Respond with clear bullet points.
`;

    const aiFeedback = await openai.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: 'You are a helpful tutor giving retry quiz feedback.' },
        { role: 'user', content: feedbackPrompt }
      ],
      temperature: 0.6
    });

    const suggestions = aiFeedback.choices[0]?.message?.content?.trim() || 'No suggestions available.';

    // 📧 Send Retry Email
    const emailContent = `
      <h2>Retried Quiz Result: ${quiz.subject} (Grade ${quiz.grade})</h2>
      <p>Hi ${user.username},</p>
      <p>You retried the quiz and scored <strong>${score}</strong> out of <strong>${quiz.maxScore}</strong>.</p>
      <h3>Suggestions to Improve Further:</h3>
      <pre>${suggestions}</pre>
      <br/>
      <p>Keep working hard and improving!</p>
      <p><strong>AI Quizzer Team</strong></p>
    `;

    await sendResultEmail({
      to: user.email,
      subject: 'Your Retried Quiz Result & Feedback',
      html: emailContent
    });

    res.status(201).json({
      message: 'Retried quiz submitted and email sent successfully.',
      score,
      total: quiz.maxScore,
      submission: newSubmission
    });

  } catch (err) {
    console.error('[Retry Quiz Error]', err);
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Bonus Features 

const hintInputSchema = z.object({
  quizId: z.string().uuid(),
  questionId: z.string()
});

export const getHintForQuestion = async (req, res) => {
    try {
        const { quizId, questionId } = req.params;

        const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });

        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const question = quiz.questions.find(q => q.questionId === questionId);

        if (!question) {
            return res.status(404).json({ error: 'Question not found in quiz' });
        }

        const prompt = `Provide a helpful hint (not the answer) for the following question:\n\n"${question.question}"\nOptions: ${question.options.join(', ')}`;

        const response = await openai.chat.completions.create({
            model: 'llama3-70b-8192',
            messages: [
                { role: 'system', content: 'You are a helpful tutor providing hints.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5
        });

        const hint = response.choices[0]?.message?.content?.trim();

        return res.status(200).json({ hint });

    } catch (err) {
        console.error('[Hint Generation Error]', err);
        res.status(500).json({ error: 'Failed to generate hint' });
    }
};