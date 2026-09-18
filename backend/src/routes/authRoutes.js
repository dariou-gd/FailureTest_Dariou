import express from 'express';
import {
  requestRegistrationCode,
  verifyCodeAndRegister,
  login,
  requestPasswordReset,
  verifyCodeAndResetPassword,
  getCurrentUser,
} from '../controllers/authController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/register/request-code', requestRegistrationCode);
router.post('/register/verify', verifyCodeAndRegister);
router.post('/login', login);
router.post('/password-reset/request', requestPasswordReset);
router.post('/password-reset/verify', verifyCodeAndResetPassword);
router.get('/me', protect, getCurrentUser);

export default router;

