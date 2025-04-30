import { userServices } from "../services/userServices"
import { NextFunction, Request, Response } from "express"
import { UserCreateType } from "../validation/userCreate"
import { Result } from "../utils/Result"
import { UserLoginType } from "../validation/userLogin"
import jwt from 'jsonwebtoken'

export const createUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { name, email, password } = req.body as UserCreateType

        const user = await userServices.createUser({
            name,
            email,
            password
        })

        res.status(201).json(new Result({
            status: true,
            message: "User created successfully",
            data: user
        }))
    } catch (error) {
        next(error)
    }
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = req.body as UserLoginType

        const result = await userServices.login(email, password)

        res.status(200).json(new Result({
            status: true,
            message: "User logged in successfully",
            data: result
        }))
    } catch (error) {
        next(error)
    }
}

export const googleAuthCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Passport.js attaches the user to the request object
        const user = req.user as any;
        
        if (!user) {
            return res.status(401).json(new Result({
                status: false,
                message: "Authentication failed",
                data: null
            }));
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email }, 
            process.env.SECRET as string
        );
        
        // Redirect to frontend with token and user data
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const redirectUrl = `${frontendUrl}/auth/callback?token=${token}&userId=${user.id}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name || '')}`;
        
        return res.redirect(redirectUrl);
    } catch (error) {
        next(error);
    }
};
