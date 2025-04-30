import { NextFunction, Request, Response } from "express";
import { AnyZodObject, ZodError } from "zod";
import BadRequest from "./handlers/errors/BadRequest";

const bodyValidation = (schema: AnyZodObject) => {

    return async (req: Request, res: Response, next: NextFunction) => {

        try {
            await schema.parseAsync(req.body);
            return next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                return next(new BadRequest('Invalid payload', 0, error.issues.map(x => x.message)));
            }
            throw next(new BadRequest(JSON.stringify(error), 0, []));
        }
    }
}

const paramValidation = (schema: AnyZodObject) => {

    return async (req: Request, res: Response, next: NextFunction) => {

        try {
            await schema.safeParseAsync(req.params);
            return next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                return next(new BadRequest('Invalid payload', 0, error.issues.map(x => x.message)));
            }
            throw next(new BadRequest(JSON.stringify(error), 0, []));
        }
    }
}


const queryValidation = (schema: AnyZodObject) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Create a processed query object that attempts to convert numeric strings to numbers
            const processedQuery = Object.fromEntries(
                Object.entries(req.query).map(([key, value]) => {
                    // If the value is a string that looks like a number, convert it
                    if (typeof value === 'string') {
                        // Check if it's a valid number string
                        if (/^\d+$/.test(value)) {
                            return [key, parseInt(value, 10)];
                        } else if (/^\d+\.\d+$/.test(value)) {
                            return [key, parseFloat(value)];
                        }
                    }
                    // Otherwise keep the original value
                    return [key, value];
                })
            );

            await schema.parseAsync(processedQuery);
            return next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                return next(new BadRequest('Invalid query parameters', 0, error.issues.map(x => x.message)));
            }
            throw next(new BadRequest(JSON.stringify(error), 0, []));
        }
    }
}

export const Validation = { bodyValidation, paramValidation, queryValidation };