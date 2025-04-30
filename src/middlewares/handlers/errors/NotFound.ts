import CustomError from "./CustomError";

class NotFound extends CustomError {

    constructor(message: string = '', code: number = 0) {
        super(code, message);
    }

}

export default NotFound