import { NextFunction, Request, Response } from "express";
import { Result } from '../../utils/Result'
import BadRequest from "./errors/BadRequest";
import NotFound from "./errors/NotFound";
import Forbidden from "./errors/Forbidden";
import NotAuthorized from "./errors/NotAuthorized";

export const globalErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {

    if (err instanceof BadRequest) {

        return res.status(400).send(new Result(
            {
                status: false,
                message: err.message,
                handler: 'GLOBAL_ERROR_HANDLER',
                validation: err.validation.length > 0 ? err.validation : undefined
            }
        ))
    }

    if (err instanceof NotFound) {
        return res.status(404).send(new Result(
            {
                status: false,
                message: err.message,
                handler: 'GLOBAL_ERROR_HANDLER'
            }
        ))
    }

    if (err instanceof Forbidden) {
        return res.status(403).send(new Result(
            {
                status: false,
                message: err.message,
                handler: 'GLOBAL_ERROR_HANDLER'
            }
        ))
    }

    if (err instanceof NotAuthorized) {
        return res.status(401).send(new Result(
            {
                status: false,
                message: err.message,
                handler: 'GLOBAL_ERROR_HANDLER'
            }
        ))
    }

    res.status(500).send(new Result({
        status: false,
        message: err.message,
        handler: 'GLOBAL_ERROR_HANDLER'
    }
    ))
}