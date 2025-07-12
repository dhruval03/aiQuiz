import { generateToken } from '../utils/jwt.util.js';
import prisma from '../config/db.js';

export const login = async (req, res) => {
  try {
    const { username } = req.body;

    let user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      user = await prisma.user.create({ data: { username } });
    }

    const token = generateToken({ id: user.id, username: user.username });

    res.json({ message: 'Login successful', token });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};