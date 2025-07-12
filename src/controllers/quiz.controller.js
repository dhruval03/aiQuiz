import prisma from '../config/db.js';
import { parseISO, startOfDay, endOfDay } from 'date-fns';
import { z } from 'zod';
import openai from '../utils/groq.js';
import { buildPrompt } from '../utils/promptBuilder.js';
import { extractJSONArray } from '../utils/jsonHelper.js';

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

        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const questions = quiz.questions;
        let score = 0;

        answers.forEach(response => {
            const question = questions.find(q => q.questionId === response.questionId);
            if (!question) return;

            const correct = question.correct;
            const userAnswer = response.userResponse;

            // Normalize both to arrays
            const correctAnswers = Array.isArray(correct) ? [...correct].sort() : [correct];
            const userAnswers = Array.isArray(userAnswer) ? [...userAnswer].sort() : [userAnswer];

            // Full match = correct
            const isCorrect = (
                correctAnswers.length === userAnswers.length &&
                correctAnswers.every((val, index) => val === userAnswers[index])
            );

            if (isCorrect) score++;
        });

        const submission = await prisma.submission.create({
            data: {
                quizId,
                userId: req.user.id,
                answers: answers,
                score
            }
        });

        return res.status(201).json({
            message: 'Quiz submitted successfully',
            score,
            total: questions.length,
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

        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const questions = quiz.questions;
        let score = 0;

        answers.forEach(res => {
            const q = questions.find(q => q.questionId === res.questionId);
            if (!q) return;

            const correctAnswer = q.correct;
            const userAnswer = res.userResponse;

            // Match exact string
            if (typeof correctAnswer[0] === 'string' && typeof userAnswer === 'string') {
                if (correctAnswer.includes(userAnswer)) score += 1;
            }

            // Match multiple correct options
            else if (Array.isArray(userAnswer) && typeof userAnswer[0] === 'string') {
                const correctSet = new Set(correctAnswer);
                const userSet = new Set(userAnswer);

                const intersection = [...userSet].filter(x => correctSet.has(x));
                const partialScore = intersection.length;
                score += partialScore;
            }

            // Match matrix answer (deep equality)
            else if (Array.isArray(userAnswer) && Array.isArray(userAnswer[0])) {
                const stringify = obj => JSON.stringify(obj);
                if (stringify(userAnswer) === stringify(correctAnswer)) {
                    score += 1;
                }
            }
        });

        const newSubmission = await prisma.submission.create({
            data: {
                quizId,
                userId: req.user.id,
                answers: answers,
                score
            }
        });

        res.status(201).json({
            message: 'Quiz retried and submitted successfully',
            score,
            total: questions.length,
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