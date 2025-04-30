import { NextFunction, Request, Response } from "express";
import { verify } from "jsonwebtoken";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import NotAuthorized from "./handlers/errors/NotAuthorized";
import Forbidden from "./handlers/errors/Forbidden";

export const Auth = (roles: string[] = []) => {
    return async (req: Request, res: Response, next: NextFunction) => {

        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');

            if (!token) {
                return next(new NotAuthorized('Unauthorized'));
            }

            try {
                const decoded: any = verify(token, process.env.SECRET as string, {
                    ignoreExpiration: true
                }) as any;
                const query = await db.select().from(Users).where(eq(Users.id, decoded.id));
                const user = query[0];

                if (!user) {
                    return next(new NotAuthorized('Invalid token'));
                }

                req.body = { ...req.body, user };
                req.body.token = decoded;
                return next();
            }
            catch (e) {
                return next(new NotAuthorized('Unauthorized'));
            }


        } catch (e) {
            return next(e);
        }
    }
}