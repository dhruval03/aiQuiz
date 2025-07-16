import { generateToken } from '../utils/jwt.util.js';
import prisma from '../config/db.js';
import bcrypt from 'bcrypt';

export const login = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    let user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      const hashPassword = await bcrypt.hash(password,10);
      user = await prisma.user.create({ data: { username, email, password:hashPassword } });
    } else {
      const valid = await bcrypt.compare(password, user.password);
      if(!valid){
        return res.status(401).json({error: 'Invalid Password'});
      }
      if(!user.email && email) {
      user = await prisma.user.update({
          where: { username },
          data: { email }
        });
      }
    }

    const token = generateToken({ id: user.id, username: user.username });

    res.json({ message: 'Login successful', token });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 