import { Router } from "express";
import { createUser, googleAuthCallback, login } from "../controllers/userController";
import { UserCreateSchema } from "../validation/userCreate";
import { UserLoginSchema } from "../validation/userLogin";
import { Validation } from "../middlewares/Validation";
import passport from "../config/passport";

const router = Router()

router.post('/signup', Validation.bodyValidation(UserCreateSchema), createUser)
router.post('/login', Validation.bodyValidation(UserLoginSchema), login)

// Google OAuth routes
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback', 
    passport.authenticate('google', { session: false, failureRedirect: '/login' }),
    googleAuthCallback
);

export { router as userRoutes }
