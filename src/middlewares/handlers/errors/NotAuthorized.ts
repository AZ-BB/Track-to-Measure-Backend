import CustomError from "./CustomError";

class NotAuthorized extends CustomError {

    constructor(message: string = '', code: number = 0) {
        super(code, message)
    }

}

export default NotAuthorized