import { z } from 'zod';

const loginSchema = z.object({
  username: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1)
});

export const validateLogin = (req, res, next) => {
  try {
    req.body = loginSchema.parse(req.body);
    next();
  } catch (err) {
    return res.status(400).json({ error: err.errors });
  }
};