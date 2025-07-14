import express from 'express';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import {
  generateQuiz,
  submitQuiz,
  getQuizHistory,
  retryQuiz,
  getHintForQuestion
} from '../controllers/quiz.controller.js';

const router = express.Router();

router.post('/generate', authenticateJWT, generateQuiz);
router.post('/submit', authenticateJWT, submitQuiz);
router.get('/history', authenticateJWT, getQuizHistory);
router.post('/retry/:quizId', authenticateJWT, retryQuiz);
router.get('/:quizId/hint/:questionId', authenticateJWT, getHintForQuestion);

export default router;
